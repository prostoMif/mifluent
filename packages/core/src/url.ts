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

/**
 * A link from source material, made safe to put in front of a person — or null.
 *
 * Material is written by strangers, and a link in a digest carries the trust
 * the person places in the digest. So a link has to pass three checks before it
 * is shown: a web scheme, a real host, and no credentials in the authority part
 * (`https://bank.com@evil.example` reads as the bank and goes to the other one).
 * Anything that fails is dropped rather than repaired.
 *
 * The fragment is removed because callers append their own text fragment, and
 * a link carrying two is a link that highlights nothing.
 */
export function toSafeLink(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null;
  if (parsed.hostname === "" || !parsed.hostname.includes(".")) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;

  parsed.hash = "";
  return parsed.toString();
}
