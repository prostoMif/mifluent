/**
 * Fetching candidate addresses during discovery.
 *
 * Most of what discovery fetches is a guess — `/feed`, `/changelog`, `/jobs` —
 * and most guesses are wrong. A 404, a timeout or a refused connection on a
 * guessed path is the expected answer, not a failure: it means "not this one".
 * So errors from the guarded client are caught here, narrowly, logged at
 * debug with the reason, and turned into "no page". Anything else — a bug —
 * is not caught.
 *
 * Every request goes through `safeFetch`: discovery fetches addresses a model
 * proposed after reading somebody's website, which is as untrusted as input
 * gets.
 *
 * // TODO: security review — fetches user- and model-supplied URLs
 */

import { isAppError, type Logger } from "@mifluent/core";
import { htmlToText, parseFeed, safeFetch } from "@mifluent/sources";

export interface FetchedPage {
  readonly url: string;
  readonly html: string;
  readonly text: string;
}

export interface Prober {
  fetchPage(url: string): Promise<FetchedPage | null>;
  /** True when the address answers with a feed that has at least one item. */
  isFeed(url: string): Promise<boolean>;
}

/** Enough for a homepage or a feed; a guess that answers with more is not what was guessed. */
const MAX_PROBE_BYTES = 200_000;

/** Discovery waits on many guesses; a slow one should not hold the whole run. */
const PROBE_TIMEOUT_MS = 10_000;

const FIRST_ERROR_STATUS = 400;

export function createProber(options: { userAgent: string; logger?: Logger | undefined }): Prober {
  const fetchOnce = async (url: string) => {
    try {
      const result = await safeFetch({
        url,
        userAgent: options.userAgent,
        maxBytes: MAX_PROBE_BYTES,
        totalTimeoutMs: PROBE_TIMEOUT_MS,
      });
      return result.status >= FIRST_ERROR_STATUS ? null : result;
    } catch (thrown) {
      if (!isAppError(thrown)) throw thrown;
      options.logger?.debug("discovery.probe_missed", { url, code: thrown.code });
      return null;
    }
  };

  return {
    async fetchPage(url) {
      const result = await fetchOnce(url);
      if (result === null) return null;
      const html = result.body.toString("utf-8");
      return { url: result.finalUrl, html, text: htmlToText(html) };
    },

    async isFeed(url) {
      const result = await fetchOnce(url);
      if (result === null) return false;
      try {
        const feed = parseFeed({
          body: result.body,
          feedUrl: result.finalUrl,
          ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
        });
        return feed.items.length > 0;
      } catch (thrown) {
        // An HTML page at a guessed feed path is the common case: not a feed.
        if (!isAppError(thrown)) throw thrown;
        options.logger?.debug("discovery.probe_not_feed", { url, code: thrown.code });
        return false;
      }
    },
  };
}
