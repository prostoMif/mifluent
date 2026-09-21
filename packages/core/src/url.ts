/**
 * URL validation shared by everything that accepts one from a person.
 *
 * `z.string().url()` is not enough. It accepts `localhost:3000`, reading it as
 * the scheme `localhost` with the path `3000` — which is precisely what someone
 * types when they mean `http://localhost:3000`. It also accepts `javascript:`
 * and `file:`, and this codebase only ever wants the two web schemes.
 *
 * This checks the shape of a string. It says nothing about whether the address
 * is safe to fetch — that is a separate check on the resolved IP, described in
 * docs/security.md §2, and it has to happen at fetch time rather than here.
 */

import { z } from "zod";

const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

export function isHttpUrl(value: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const httpUrlSchema = z
  .string()
  .trim()
  .refine(isHttpUrl, { message: "Use a full address starting with http:// or https://" });
