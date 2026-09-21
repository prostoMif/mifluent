/**
 * The RSS connector: one poll of one feed, start to finish.
 *
 * Thin on purpose. Fetching is guarded in `http/`, parsing is defensive in
 * `feeds/`, and identity is decided in `feeds/identity.ts`; this file only puts
 * the three in order and shapes the result the way the pipeline wants it. A
 * connector that grew logic of its own would be a fourth place to look when a
 * source misbehaves.
 *
 * Nothing here touches the database. The caller decides what to store, which is
 * what makes a poll testable without one.
 */

import { AppError, httpUrlSchema, parseOrThrow } from "@mifluent/core";
import { fingerprintItem } from "../feeds/identity.js";
import { type FeedItem, parseFeed } from "../feeds/parse-feed.js";
import { safeFetch } from "../http/safe-fetch.js";

/** Validates what a person typed into the "feed address" box. */
export const rssLocatorSchema = httpUrlSchema;

export interface PolledItem extends FeedItem {
  /**
   * Stable identity for this item, as a hex digest. The unique index on raw
   * items is what actually enforces "only once"; this is the value it sees.
   */
  readonly fingerprint: string;
}

export interface RssPollOptions {
  readonly feedUrl: string;
  readonly userAgent: string;
  /** Kept from the previous poll, so an unchanged feed answers 304. */
  readonly etag?: string | undefined;
  readonly lastModifiedAt?: string | undefined;
  readonly now?: Date | undefined;
}

export interface RssPollResult {
  /** The server said nothing changed. `items` is empty and that is correct. */
  readonly isUnchanged: boolean;
  /** Store these and send them back next time. */
  readonly etag: string | undefined;
  readonly lastModifiedAt: string | undefined;
  readonly feedTitle: string | null;
  readonly siteUrl: string | null;
  readonly items: readonly PolledItem[];
}

/** Below this a response is an answer; at or above it, it is a refusal. */
const FIRST_ERROR_STATUS = 400;

export async function pollRssSource(options: RssPollOptions): Promise<RssPollResult> {
  const feedUrl = parseOrThrow(rssLocatorSchema, options.feedUrl);

  const response = await safeFetch({
    url: feedUrl,
    userAgent: options.userAgent,
    ...(options.etag === undefined ? {} : { etag: options.etag }),
    ...(options.lastModifiedAt === undefined ? {} : { lastModifiedAt: options.lastModifiedAt }),
  });

  if (response.isUnchanged) {
    return {
      isUnchanged: true,
      // Carried forward: a 304 usually repeats the validators, but not always,
      // and losing them would mean fetching the whole feed on the next poll.
      etag: response.etag ?? options.etag,
      lastModifiedAt: response.lastModifiedAt ?? options.lastModifiedAt,
      feedTitle: null,
      siteUrl: null,
      items: [],
    };
  }

  if (response.status >= FIRST_ERROR_STATUS) {
    throw new AppError("source_unreachable", "That source answered with an error.", {
      feedUrl,
      httpStatus: response.status,
    });
  }

  const parsed = parseFeed({
    body: response.body,
    ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
    // Relative links are resolved against where the feed actually came from,
    // which after a redirect is not where it was asked for.
    feedUrl: response.finalUrl,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    isUnchanged: false,
    etag: response.etag,
    lastModifiedAt: response.lastModifiedAt,
    feedTitle: parsed.title,
    siteUrl: parsed.siteUrl,
    items: parsed.items.map((item) => ({
      ...item,
      fingerprint: fingerprintItem({
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        content: item.content,
        // The configured address, not the one after redirects. A feed that
        // moves must not make every item it has ever carried look new.
        feedUrl,
      }),
    })),
  };
}
