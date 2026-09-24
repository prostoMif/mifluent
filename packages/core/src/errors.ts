/**
 * One error type for the whole application.
 *
 * The split that matters: `message` is safe to show a user, `details` is for the
 * log and never crosses the API boundary. Anything that would help an attacker —
 * SQL, internal paths, driver output — belongs in `details` or nowhere.
 */

export type ErrorCode =
  // Client mistakes
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  // Ingestion
  | "source_unreachable"
  | "source_unsupported"
  | "url_not_allowed"
  | "content_too_large"
  // Model pipeline
  | "model_unavailable"
  | "model_response_invalid"
  | "quote_not_found"
  // Delivery and limits
  | "delivery_failed"
  | "plan_limit_reached"
  | "cost_cap_reached"
  // Configuration and everything else
  | "configuration_invalid"
  | "internal_error";

export type ErrorDetails = Readonly<Record<string, unknown>>;

const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,

  source_unreachable: 502,
  source_unsupported: 400,
  url_not_allowed: 400,
  content_too_large: 413,

  model_unavailable: 503,
  model_response_invalid: 502,
  quote_not_found: 422,

  delivery_failed: 502,
  plan_limit_reached: 403,
  cost_cap_reached: 503,

  configuration_invalid: 500,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.details = details;
  }

  /** The only shape allowed to reach a client. */
  toPublic(): { code: ErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Turn anything thrown into an AppError.
 *
 * An unrecognised error becomes a generic `internal_error` on purpose: its
 * original message may contain internals, so it goes to `details` for the log
 * and never to the user.
 */
export function toAppError(thrown: unknown): AppError {
  if (isAppError(thrown)) {
    return thrown;
  }

  if (thrown instanceof Error) {
    return new AppError("internal_error", "Something went wrong on our side.", {
      originalName: thrown.name,
      originalMessage: thrown.message,
      stack: thrown.stack,
    });
  }

  return new AppError("internal_error", "Something went wrong on our side.", {
    thrown: String(thrown),
  });
}
