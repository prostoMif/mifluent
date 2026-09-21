/**
 * The only way this application fetches a URL somebody else chose.
 *
 * Everything here exists because the address is untrusted. The rules, and what
 * each one stops:
 *
 * - **Only http and https.** A file address reads the disk, and gopher can be
 *   made to speak other protocols entirely.
 * - **The resolved address is checked, not the URL string.** A hostname the
 *   attacker owns can point anywhere. See `address-rules.ts`.
 * - **Every redirect hop is checked again, from scratch.** The classic bypass
 *   is a public first hop redirecting to the cloud metadata service. A check
 *   done once, before the first request, catches none of it.
 * - **Redirects are followed by hand.** Handing that job to the HTTP client
 *   would have it resolve and connect on its own, past every check above.
 * - **A byte cap that aborts mid-stream.** Content-Length is a claim, not a
 *   fact, so the cap counts bytes actually received — and counts them after
 *   decompression, so a small compressed file cannot expand into a large one.
 * - **Two timeouts.** One for a connection that goes quiet, one for a server
 *   that dribbles a byte at a time forever.
 *
 * // TODO: security review — fetches user-supplied URLs
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { createGunzip, createInflate } from "node:zlib";
import { AppError } from "@mifluent/core";
import { type ResolvedHost, resolvePublicHost } from "./resolve-host.js";

const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

/**
 * 5 MB. A feed or an article page above this is either a mistake or an attempt
 * to fill the disk, and both are handled the same way.
 */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Silence on the socket for this long means the other end is gone. */
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;

/**
 * A ceiling on the whole exchange, redirects included. Without it a server that
 * sends one byte every ten seconds holds a worker open indefinitely, which is a
 * denial of service costing the attacker nothing.
 */
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

/** docs/security.md asks for three to five. More than that is a loop. */
const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

const NOT_MODIFIED = 304;

export interface SafeFetchOptions {
  readonly url: string;
  /** Sent so whoever is being polled can see who is polling them. */
  readonly userAgent: string;
  /**
   * The previous ETag and Last-Modified, if the caller kept them.
   *
   * Borrowed as an idea, not as code, from how Miniflux polls feeds. The
   * observation it rests on: a feed reader is a program that asks the same
   * question every hour and almost always gets the same answer. Storing the
   * validators a server hands out, and sending them back on the next poll,
   * turns that into a 304 with no body — a few hundred bytes instead of a few
   * hundred kilobytes, for both sides.
   *
   * It matters more than bandwidth. A polite client stays welcome; an impolite
   * one gets rate-limited or blocked, and then the product stops working for a
   * reason its owner cannot see.
   */
  readonly etag?: string | undefined;
  readonly lastModifiedAt?: string | undefined;
  readonly maxBytes?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly totalTimeoutMs?: number | undefined;
  readonly maxRedirects?: number | undefined;
}

export interface SafeFetchResult {
  readonly status: number;
  /** True when the server said 304: nothing changed, no body sent. */
  readonly isUnchanged: boolean;
  readonly body: Buffer;
  /** Where the response actually came from, after any redirects. */
  readonly finalUrl: string;
  readonly contentType: string | undefined;
  readonly etag: string | undefined;
  readonly lastModifiedAt: string | undefined;
}

export async function safeFetch(options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = Date.now() + (options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);

  let currentUrl = parseUrl(options.url);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await requestOnce(currentUrl, options, deadline);
    const status = response.statusCode ?? 0;

    if (!REDIRECT_STATUSES.includes(status)) {
      return await readResult(response, currentUrl, options);
    }

    // The body of a redirect is of no interest, and leaving it unread holds the
    // socket open until it times out.
    response.resume();

    currentUrl = nextUrl(response, currentUrl);
  }

  throw new AppError("source_unreachable", "That address redirects too many times.", {
    url: options.url,
    maxRedirects,
  });
}

/**
 * Hand the already-checked address back to the socket layer.
 *
 * Two shapes, and getting this wrong is invisible until it is not. Since Node
 * 20, connections try IPv6 and IPv4 in parallel by default, and to do that the
 * socket layer asks for *every* address at once — `all: true` — and expects an
 * array in reply. Answering with a bare string there makes it read `undefined`
 * as the address and fail with a message that mentions none of this.
 *
 * The single-address form is still used elsewhere, so both are answered.
 */
export function answerLookup(
  host: ResolvedHost,
  wantsEveryAddress: boolean,
  callback: LookupCallback,
): void {
  if (wantsEveryAddress) {
    // The one assertion in this file. Node's own type for the callback
    // describes only the single-address form, while the runtime accepts both;
    // the array shape is what `all: true` requires.
    (callback as unknown as EveryAddressCallback)(null, [
      { address: host.address, family: host.family },
    ]);
    return;
  }

  callback(null, host.address, host.family);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

type EveryAddressCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: readonly { address: string; family: number }[],
) => void;

function parseUrl(value: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new AppError("url_not_allowed", "That does not look like a web address.");
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new AppError("url_not_allowed", "Only http and https addresses can be used.", {
      protocol: parsed.protocol,
    });
  }

  return parsed;
}

function nextUrl(response: IncomingMessage, from: URL): URL {
  const location = response.headers.location;

  if (typeof location !== "string" || location === "") {
    throw new AppError("source_unreachable", "That address redirected to nowhere.");
  }

  // Resolved against the current URL, because a Location header is allowed to
  // be relative. `parseUrl` then applies the protocol rule to the result, and
  // `requestOnce` resolves and checks the new host from scratch.
  return parseUrl(new URL(location, from).toString());
}

async function requestOnce(
  url: URL,
  options: SafeFetchOptions,
  deadline: number,
): Promise<IncomingMessage> {
  const remainingMs = deadline - Date.now();

  if (remainingMs <= 0) {
    throw new AppError("source_unreachable", "That address took too long to answer.", {
      url: url.toString(),
    });
  }

  const host = await resolvePublicHost(url.hostname);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: "GET",
        headers: buildHeaders(options),
        // The address was resolved and checked a moment ago. Handing it back
        // here is what stops the socket layer asking DNS a second time and
        // acting on a different answer.
        lookup: (_hostname, lookupOptions, callback) => {
          answerLookup(host, lookupOptions.all === true, callback);
        },
        // The certificate is still checked against the name in the URL rather
        // than against the address being dialled.
        servername: url.hostname,
        timeout: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      },
      resolve,
    );

    const total = setTimeout(() => {
      request.destroy(
        new AppError("source_unreachable", "That address took too long to answer.", {
          url: url.toString(),
        }),
      );
    }, remainingMs);

    // Node keeps the process alive for a pending timer, and a poll that already
    // finished should not hold a worker open for another half minute.
    total.unref();

    request.on("timeout", () => {
      request.destroy(
        new AppError("source_unreachable", "That address stopped responding.", {
          url: url.toString(),
        }),
      );
    });

    request.on("error", (error: unknown) => {
      clearTimeout(total);
      reject(
        error instanceof AppError
          ? error
          : new AppError("source_unreachable", "That address could not be reached.", {
              url: url.toString(),
            }),
      );
    });

    request.on("response", () => {
      clearTimeout(total);
    });

    request.end();
  });
}

function buildHeaders(options: SafeFetchOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": options.userAgent,
    Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html",
    "Accept-Encoding": "gzip, deflate",
  };

  if (options.etag !== undefined) {
    headers["If-None-Match"] = options.etag;
  }

  if (options.lastModifiedAt !== undefined) {
    headers["If-Modified-Since"] = options.lastModifiedAt;
  }

  return headers;
}

async function readResult(
  response: IncomingMessage,
  url: URL,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const status = response.statusCode ?? 0;
  const isUnchanged = status === NOT_MODIFIED;

  if (isUnchanged) {
    response.resume();
  }

  const body = isUnchanged
    ? Buffer.alloc(0)
    : await readBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);

  return {
    status,
    isUnchanged,
    body,
    finalUrl: url.toString(),
    contentType: readHeader(response, "content-type"),
    etag: readHeader(response, "etag"),
    lastModifiedAt: readHeader(response, "last-modified"),
  };
}

function readHeader(response: IncomingMessage, name: string): string | undefined {
  const value = response.headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Collect the body, stopping the moment it grows past the cap.
 *
 * The count is on decompressed bytes on purpose. A few kilobytes of gzip can
 * expand into gigabytes, and a cap applied to what arrived on the wire would
 * not notice until the process ran out of memory.
 */
async function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const stream = decompress(response);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const stop = (error: AppError): void => {
      response.destroy();
      stream.destroy();
      reject(error);
    };

    stream.on("data", (chunk: Buffer) => {
      received += chunk.length;

      if (received > maxBytes) {
        stop(
          new AppError("content_too_large", "That source sent more than we are willing to read.", {
            maxBytes,
          }),
        );
        return;
      }

      chunks.push(chunk);
    });

    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    stream.on("error", () => {
      stop(new AppError("source_unreachable", "That source sent a broken response."));
    });
  });
}

function decompress(response: IncomingMessage): Readable {
  const encoding = (readHeader(response, "content-encoding") ?? "").toLowerCase();

  if (encoding === "gzip") {
    return response.pipe(createGunzip());
  }

  if (encoding === "deflate") {
    return response.pipe(createInflate());
  }

  return response;
}
