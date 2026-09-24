/**
 * Comparing a secret someone sent with the one in configuration.
 *
 * `===` on strings stops at the first differing character, and the time that
 * takes leaks how much of a guess was right. Both sides are hashed first so
 * the comparison is over equal-length buffers whatever was sent.
 *
 * // TODO: security review — authentication of webhooks
 */

import { createHash, timingSafeEqual } from "node:crypto";

export function isSameSecret(
  received: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (received === null || received === undefined || expected === undefined || expected === "") {
    return false;
  }
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
