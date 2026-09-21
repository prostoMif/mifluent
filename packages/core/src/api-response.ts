/**
 * Every endpoint returns one of exactly two shapes. A client should never have
 * to inspect a status code to work out which one it got.
 */

import { type ErrorCode, toAppError } from "./errors.js";

export interface ApiSuccess<T> {
  readonly data: T;
}

export interface ApiFailure {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

export function isFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return "error" in response;
}

/**
 * Convert anything thrown in a handler into a response body and status.
 *
 * Note what is *not* returned: details. They belong in the log — the caller is
 * expected to log the AppError separately before sending this.
 */
export function toErrorResponse(thrown: unknown): {
  body: ApiFailure;
  status: number;
} {
  const error = toAppError(thrown);
  return {
    body: { error: error.toPublic() },
    status: error.httpStatus,
  };
}
