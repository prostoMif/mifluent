/**
 * Zod at the boundary, turned into an `AppError`.
 *
 * Calling `schema.parse()` directly in a handler throws a `ZodError`, which the
 * route wrapper cannot recognise and therefore reports as an internal error.
 * The caller then gets a 500 and the message "something went wrong on our side"
 * for a typo in their own request.
 *
 * Everything that validates an incoming payload goes through here instead.
 */

import type { ZodType } from "zod";
import { AppError } from "./errors.js";

/** Structural, so this does not depend on a particular Zod minor version. */
interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * "email: Enter an email address." — the field name is included because a form
 * with six inputs and a bare "Required" tells the person nothing.
 */
function describe(issues: readonly Issue[]): string {
  const first = issues[0];

  if (first === undefined) {
    return "That request could not be read.";
  }

  const field = first.path.map(String).join(".");
  return field === "" ? first.message : `${field}: ${first.message}`;
}

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  // Messages are written by us and are safe to show. The full issue list goes
  // to the log, where the field paths are worth having.
  throw new AppError("validation_failed", describe(result.error.issues), {
    issues: result.error.issues,
  });
}
