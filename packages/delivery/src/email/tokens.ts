/**
 * HMAC tokens for email action links.
 *
 * Token format: base64url(payload).base64url(signature)
 * Payload: cardId|action|exp (exp = Unix timestamp, 30 days from creation)
 * Signature: HMAC-SHA256(EMAIL_LINK_SECRET, payload)
 *
 * The token is not encrypted — the payload is readable. The signature prevents
 * forgery. Expired or tampered tokens are rejected.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@mifluent/core";

export interface ActionTokenPayload {
  readonly cardId: string;
  readonly action: string;
  readonly exp: number; // Unix timestamp in seconds
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function signPayload(secret: string, payload: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return base64urlEncode(hmac.digest("base64url"));
}

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = signPayload(secret, payload);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function createActionToken(secret: string, cardId: string, action: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${cardId}|${action}|${exp}`;
  const encodedPayload = base64urlEncode(payload);
  const signature = signPayload(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseActionToken(secret: string, token: string): ActionTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new AppError("invalid_token", "Invalid token format.");
  }

  const [encodedPayload, signature] = parts as [string, string];

  if (!verifySignature(secret, encodedPayload, signature)) {
    throw new AppError("invalid_token", "Invalid token signature.");
  }

  let payload: string;
  try {
    payload = base64urlDecode(encodedPayload);
  } catch {
    throw new AppError("invalid_token", "Invalid token payload.");
  }

  const [cardId, action, expStr] = payload.split("|");
  if (!cardId || !action || !expStr) {
    throw new AppError("invalid_token", "Invalid token payload structure.");
  }

  const exp = parseInt(expStr, 10);
  if (Number.isNaN(exp)) {
    throw new AppError("invalid_token", "Invalid token expiry.");
  }

  if (exp < Math.floor(Date.now() / 1000)) {
    throw new AppError("token_expired", "This link has expired.");
  }

  return { cardId, action, exp };
}

export interface UnsubscribeTokenPayload {
  readonly profileId: string;
  readonly exp: number;
}

export function createUnsubscribeToken(secret: string, profileId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${profileId}|unsubscribe|${exp}`;
  const encodedPayload = base64urlEncode(payload);
  const signature = signPayload(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseUnsubscribeToken(secret: string, token: string): UnsubscribeTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new AppError("invalid_token", "Invalid token format.");
  }

  const [encodedPayload, signature] = parts as [string, string];

  if (!verifySignature(secret, encodedPayload, signature)) {
    throw new AppError("invalid_token", "Invalid token signature.");
  }

  let payload: string;
  try {
    payload = base64urlDecode(encodedPayload);
  } catch {
    throw new AppError("invalid_token", "Invalid token payload.");
  }

  const [profileId, action, expStr] = payload.split("|");
  if (!profileId || action !== "unsubscribe" || !expStr) {
    throw new AppError("invalid_token", "Invalid token payload structure.");
  }

  const exp = parseInt(expStr, 10);
  if (Number.isNaN(exp)) {
    throw new AppError("invalid_token", "Invalid token expiry.");
  }

  if (exp < Math.floor(Date.now() / 1000)) {
    throw new AppError("token_expired", "This link has expired.");
  }

  return { profileId, exp };
}
