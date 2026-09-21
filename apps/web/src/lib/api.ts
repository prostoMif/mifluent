/**
 * The single place where a route handler turns into an HTTP response.
 *
 * Every handler goes through `route()`. That is what guarantees the two rules
 * this file exists for: the response is always the same envelope, and an error
 * never leaks anything past the boundary. Details go to the log, a code and a
 * safe message go to the caller.
 *
 * Handlers themselves stay thin — validate, call a package, return. No business
 * logic lives here or in any route file.
 */

import { AppError, ok, toAppError } from "@mifluent/core";
import { logger } from "./logger";

interface RouteOptions {
  /** Log event name, in `<domain>.<past-tense-action>` form. */
  readonly event: string;
  /** Response status on success. Defaults to 200. */
  readonly status?: number;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // Responses are per-user by definition. Nothing here may sit in a shared
  // cache, and "no-store" is the only header every intermediary agrees on.
  "Cache-Control": "no-store",
} as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Run a handler, wrap what it returns, and convert anything it throws.
 *
 * @example
 * export async function GET() {
 *   return route({ event: "sources.listed" }, async () => listSources(tenantId));
 * }
 */
export async function route<T>(options: RouteOptions, handle: () => Promise<T>): Promise<Response> {
  const startedAt = Date.now();

  try {
    const data = await handle();

    logger.info(options.event, { durationMs: Date.now() - startedAt });
    return json(ok(data), options.status ?? 200);
  } catch (thrown) {
    const error = toAppError(thrown);

    // Client mistakes are not incidents. Logging them at error level trains
    // whoever is on call to ignore the error level.
    const level = error.httpStatus >= 500 ? "error" : "warn";
    logger[level](`${options.event}.failed`, {
      code: error.code,
      httpStatus: error.httpStatus,
      durationMs: Date.now() - startedAt,
      details: error.details,
    });

    return json({ error: error.toPublic() }, error.httpStatus);
  }
}

/**
 * The body of a request, as unparsed JSON.
 *
 * `request.json()` throws a `SyntaxError` on malformed input, which would be
 * reported as an internal error — a 500 blamed on the server for a truncated
 * upload. Validate the result with a schema before using it.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("validation_failed", "The request body was not valid JSON.");
  }
}
