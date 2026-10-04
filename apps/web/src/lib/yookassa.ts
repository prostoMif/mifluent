/**
 * ЮKassa: create the payment a person is sent to, and read back what really
 * happened to it.
 *
 * Everything provider-specific lives in this file. The protocol, from the
 * ЮKassa API reference (yookassa.ru/developers):
 *
 * - `POST https://api.yookassa.ru/v3/payments`, HTTP Basic auth with the shop
 *   id and the secret key, an `Idempotence-Key` header, a JSON body with
 *   `amount {value, currency}`, `capture: true`, `confirmation {type:
 *   "redirect", return_url}`, `description` (≤ 128 characters) and
 *   `metadata`. The answer carries `confirmation.confirmation_url`.
 * - Notifications are a JSON POST `{type: "notification", event, object}`.
 *   They are NOT signed. ЮKassa's own advice is to check the object's current
 *   state through the API — which is what `fetchPayment` is for: the webhook
 *   trusts nothing in the body except the payment id, and asks ЮKassa itself
 *   for the status, the amount and our order id.
 *
 * The order id is the idempotence key: pressing "Pay" twice for one order
 * returns the same payment instead of charging twice.
 *
 * // TODO: security review — payments, webhook authentication
 */

import { AppError, type RawConfig } from "@mifluent/core";
import { z } from "zod";

export const YOOKASSA_API = "https://api.yookassa.ru/v3";

/** ЮKassa's limit on `description`. */
const MAX_DESCRIPTION = 128;

export interface YookassaCredentials {
  readonly shopId: string;
  readonly secretKey: string;
}

/** Replaces the network, for tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The credentials, when payments are switched on. */
export function yookassaCredentials(
  config: Pick<RawConfig, "YOOKASSA_SHOP_ID" | "YOOKASSA_SECRET_KEY">,
): YookassaCredentials | undefined {
  if (config.YOOKASSA_SHOP_ID === undefined || config.YOOKASSA_SECRET_KEY === undefined) {
    return undefined;
  }
  return { shopId: config.YOOKASSA_SHOP_ID, secretKey: config.YOOKASSA_SECRET_KEY };
}

export function isPaymentEnabled(
  config: Pick<RawConfig, "YOOKASSA_SHOP_ID" | "YOOKASSA_SECRET_KEY">,
): boolean {
  return yookassaCredentials(config) !== undefined;
}

const paymentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
  paid: z.boolean().optional(),
  amount: z.object({ value: z.string(), currency: z.string() }),
  metadata: z.record(z.string(), z.string()).optional(),
  confirmation: z.object({ type: z.string(), confirmation_url: z.string().optional() }).optional(),
});

export type YookassaPayment = z.infer<typeof paymentSchema>;

export interface CreatePaymentInput {
  readonly orderId: string;
  /** Kopecks or cents. */
  readonly amountMinor: number;
  readonly currency: "RUB" | "USD";
  readonly description: string;
  readonly returnUrl: string;
}

export async function createPayment(
  credentials: YookassaCredentials,
  input: CreatePaymentInput,
  fetchImpl: FetchLike = fetch,
): Promise<{ paymentId: string; confirmationUrl: string }> {
  const response = await fetchImpl(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(credentials),
      "Idempotence-Key": input.orderId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: { value: formatAmount(input.amountMinor), currency: input.currency },
      capture: true,
      confirmation: { type: "redirect", return_url: input.returnUrl },
      description: input.description.slice(0, MAX_DESCRIPTION),
      metadata: { orderId: input.orderId },
    }),
  });

  const payment = await readPayment(response, "payment_provider_failed");
  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (confirmationUrl === undefined || !confirmationUrl.startsWith("https://")) {
    throw new AppError("payment_provider_failed", "ЮKassa returned no payment page.", {
      paymentId: payment.id,
    });
  }
  return { paymentId: payment.id, confirmationUrl };
}

/** The payment as ЮKassa sees it right now. */
export async function fetchPayment(
  credentials: YookassaCredentials,
  paymentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<YookassaPayment> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(paymentId)) {
    throw new AppError("validation_failed", "Not a ЮKassa payment id.");
  }
  const response = await fetchImpl(`${YOOKASSA_API}/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: basicAuth(credentials) },
  });
  return readPayment(response, "payment_provider_failed");
}

const notificationSchema = z.object({
  type: z.literal("notification"),
  event: z.string(),
  object: z.object({ id: z.string().min(1) }).passthrough(),
});

/** The payment id a notification is about, or undefined if it is not one we act on. */
export function readNotificationPaymentId(body: unknown): string | undefined {
  const parsed = notificationSchema.safeParse(body);
  if (!parsed.success) return undefined;
  if (!parsed.data.event.startsWith("payment.")) return undefined;
  return parsed.data.object.id;
}

export interface PaymentOutcome {
  readonly eventKey: string;
  readonly orderId: string;
  readonly isPaid: boolean;
  readonly paidAmountMinor: number;
}

/**
 * What the verified payment means for our order. Undefined while it is still
 * in progress, or when it names no order of ours.
 */
export function outcomeOf(payment: YookassaPayment): PaymentOutcome | undefined {
  const orderId = payment.metadata?.["orderId"];
  if (orderId === undefined) return undefined;
  if (payment.status !== "succeeded" && payment.status !== "canceled") return undefined;
  return {
    // One payment reaches each final status once; a retried notification
    // repeats the key and becomes a no-op.
    eventKey: `${payment.id}:${payment.status}`,
    orderId,
    isPaid: payment.status === "succeeded",
    paidAmountMinor: parseAmountMinor(payment.amount.value),
  };
}

/** "790.00" from 79000. */
export function formatAmount(amountMinor: number): string {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new AppError(
      "validation_failed",
      "An amount must be a positive whole number of kopecks.",
    );
  }
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

/** 79000 from "790.00"; -1 for anything that is not a money amount. */
export function parseAmountMinor(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) return -1;
  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fraction = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  return whole * 100 + fraction;
}

function basicAuth(credentials: YookassaCredentials): string {
  const token = Buffer.from(`${credentials.shopId}:${credentials.secretKey}`, "utf8").toString(
    "base64",
  );
  return `Basic ${token}`;
}

async function readPayment(
  response: Response,
  code: "payment_provider_failed",
): Promise<YookassaPayment> {
  const text = await response.text();
  if (!response.ok) {
    // The body names the problem ("invalid_credentials", "invalid_request")
    // but never the key; it is safe to log.
    throw new AppError(code, "ЮKassa refused the request.", {
      httpStatus: response.status,
      body: text.slice(0, 500),
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError(code, "ЮKassa answered with something that is not JSON.");
  }
  const parsed = paymentSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(code, "ЮKassa answered with an unexpected payment object.");
  }
  return parsed.data;
}
