/**
 * The browser side of our own API.
 *
 * One function, so that every form sends the same headers and unwraps the same
 * envelope. The envelope is the reason this exists: every endpoint answers with
 * `{ data }` or `{ error }`, and a component that reads `response.ok` instead
 * would eventually render an error object as if it were a result.
 */

import { toDisplayMessage } from "./error-message";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions {
  readonly method: Method;
  readonly path: string;
  readonly body?: unknown;
}

/**
 * Thrown when the server refuses. Carries the stable code so a caller can
 * branch on it, and a message that is already safe to show.
 */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function sendRequest<T>(options: RequestOptions): Promise<T> {
  // Built in two steps rather than with `body: undefined`, which
  // `exactOptionalPropertyTypes` treats as "a body that is undefined" and
  // refuses — correctly, since that is not the same as having no body.
  const init: RequestInit = {
    method: options.method,
    // Every answer here is per-user and changes; a cached one would show a
    // progress screen that never moves.
    cache: "no-store",
    // JSON is not a form content type, so the browser preflights it and a
    // cross-site page cannot send it silently. The server checks the origin
    // as well; this is not the control, only the reason it is cheap.
    headers: { "Content-Type": "application/json" },
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(options.path, init);

  const payload: unknown = await response.json().catch(() => undefined);

  if (typeof payload !== "object" || payload === null) {
    throw new ApiError("internal_error", "The server did not answer properly.");
  }

  if ("error" in payload) {
    throw new ApiError(readErrorCode(payload.error), toDisplayMessage(payload));
  }

  if (!("data" in payload)) {
    throw new ApiError("internal_error", "The server did not answer properly.");
  }

  /*
   * The one assertion in this file, and it is narrow: the endpoint's contract
   * says what `data` holds and the caller states it as `T`. Validating every
   * response against a second schema in the browser would mean maintaining the
   * same shape twice, and the server already validated what it wrote.
   */
  return payload.data as T;
}

function readErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string") {
      return code;
    }
  }

  return "internal_error";
}
