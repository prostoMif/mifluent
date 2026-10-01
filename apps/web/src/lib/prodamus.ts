/**
 * Prodamus: the payment page link we send a person to, and the notification
 * Prodamus sends back when they have paid.
 *
 * Everything provider-specific lives in this file, so that when the formats
 * below are checked against the shop's own dashboard (and corrected if they
 * differ) nothing else changes. What is assumed here, from Prodamus's public
 * client libraries:
 *
 * - the payment page takes `order_id`, `products[0][name|price|quantity]`,
 *   `customer_email`, `urlNotification`, `urlSuccess`, `urlReturn`, `do=pay`;
 * - the notification is a form POST whose `order_num` echoes our `order_id`,
 *   with `sum` and `payment_status` (`success` when paid);
 * - the `Sign` header is HMAC-SHA256 (hex) of the body as JSON with keys
 *   sorted at every level, every value a string, and `/` escaped as `\/`
 *   (PHP's json_encode default), keyed with the shop's secret.
 *
 * Verify all three with a test payment before taking real money.
 *
 * // TODO: security review — payments, webhook authentication
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface PaymentLinkInput {
  /** The shop's payment page, e.g. https://myshop.payform.ru */
  readonly shopUrl: string;
  readonly orderId: string;
  /** Major units: 790 or 6.5. */
  readonly amount: number;
  readonly productName: string;
  readonly customerEmail: string | null;
  readonly notificationUrl: string;
  readonly successUrl: string;
  readonly returnUrl: string;
}

export function buildPaymentLink(input: PaymentLinkInput): string {
  const url = new URL(input.shopUrl);
  const params: Record<string, string> = {
    do: "pay",
    order_id: input.orderId,
    "products[0][name]": input.productName,
    "products[0][price]": input.amount.toFixed(2),
    "products[0][quantity]": "1",
    urlNotification: input.notificationUrl,
    urlSuccess: input.successUrl,
    urlReturn: input.returnUrl,
  };
  if (input.customerEmail !== null) params["customer_email"] = input.customerEmail;

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** A nested record: `products[0][name]=X` becomes `{ products: { "0": { name: "X" } } }`. */
export type FormTree = { [key: string]: string | FormTree };

export function parseFormBody(body: string): FormTree {
  const tree: FormTree = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const path = rawKey.split(/\[|\]/).filter((part) => part !== "");
    setAt(tree, path, value);
  }
  return tree;
}

export function signForm(tree: FormTree, secret: string): string {
  const json = JSON.stringify(sortTree(tree)).replace(/\//g, "\\/");
  return createHmac("sha256", secret).update(json, "utf8").digest("hex");
}

/** Constant-time: the comparison must not tell an attacker how close a guess was. */
export function isValidSignature(tree: FormTree, header: string | null, secret: string): boolean {
  if (header === null || header.trim() === "") return false;
  const expected = Buffer.from(signForm(tree, secret), "utf8");
  const received = Buffer.from(header.trim().toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface ParsedNotification {
  readonly eventKey: string;
  readonly orderId: string;
  readonly isPaid: boolean;
  readonly paidAmountMinor: number;
}

/** The fields we act on; undefined when the notification names no order. */
export function readNotification(tree: FormTree): ParsedNotification | undefined {
  const orderId = text(tree["order_num"]) ?? text(tree["order_id"]);
  if (orderId === undefined) return undefined;

  const sum = Number.parseFloat(text(tree["sum"]) ?? "");
  return {
    // Prodamus's own id for the payment plus its status: a retried delivery
    // repeats both, a different event (paid after failed) differs.
    eventKey:
      text(tree["order_id"]) !== undefined
        ? `${text(tree["order_id"])}:${text(tree["payment_status"]) ?? ""}`
        : createHash("sha256")
            .update(JSON.stringify(sortTree(tree)))
            .digest("hex"),
    orderId,
    isPaid: text(tree["payment_status"]) === "success",
    paidAmountMinor: Number.isFinite(sum) ? Math.round(sum * 100) : -1,
  };
}

function text(value: string | FormTree | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Keys that would reach an object's prototype instead of the object itself. */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function setAt(tree: FormTree, path: readonly string[], value: string): void {
  const [head, ...rest] = path;
  // The body is attacker-controlled until the signature is checked, and the
  // signature is checked on this very tree: a `__proto__[x]` field must not
  // reach Object.prototype on the way.
  if (head === undefined || FORBIDDEN_KEYS.has(head)) return;
  if (rest.length === 0) {
    tree[head] = value;
    return;
  }
  const existing = tree[head];
  const child: FormTree = typeof existing === "object" ? existing : {};
  tree[head] = child;
  setAt(child, rest, value);
}

function sortTree(tree: FormTree): FormTree {
  const sorted: FormTree = {};
  for (const key of Object.keys(tree).sort()) {
    const value = tree[key];
    if (value === undefined) continue;
    sorted[key] = typeof value === "string" ? value : sortTree(value);
  }
  return sorted;
}
