/**
 * Zod issues, rearranged for a form.
 *
 * A form needs one message per field, not a list of issues. Showing only the
 * first issue per field is deliberate: three complaints about the same input
 * read as noise, and the person fixes them one at a time anyway.
 */

import type { ZodError } from "zod";

export type FieldErrors = Readonly<Record<string, string | undefined>>;

export function toFieldErrors(error: ZodError): FieldErrors {
  const result: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (typeof field !== "string" || field in result) {
      continue;
    }

    result[field] = issue.message;
  }

  return result;
}
