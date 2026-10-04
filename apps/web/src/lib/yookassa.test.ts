import { describe, expect, it } from "vitest";
import {
  createPayment,
  type FetchLike,
  fetchPayment,
  formatAmount,
  outcomeOf,
  parseAmountMinor,
  readNotificationPaymentId,
  type YookassaPayment,
} from "./yookassa";

const credentials = { shopId: "123456", secretKey: "test_secret_key_value_1234" };

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }) {
  const impl: FetchLike = async (url, init) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status });
  };
  return impl;
}

const succeeded: YookassaPayment = {
  id: "2f3c0a1b-000f-5000-9000-1b2c3d4e5f60",
  status: "succeeded",
  paid: true,
  amount: { value: "790.00", currency: "RUB" },
  metadata: { orderId: "0192a7c4-0000-7000-8000-000000000001" },
};

describe("amounts", () => {
  it("writes kopecks as ЮKassa's decimal string", () => {
    expect(formatAmount(79_000)).toBe("790.00");
    expect(formatAmount(105)).toBe("1.05");
  });

  it("refuses an amount that is not a positive whole number of kopecks", () => {
    expect(() => formatAmount(0)).toThrow();
    expect(() => formatAmount(10.5)).toThrow();
  });

  it("reads ЮKassa's decimal string back into kopecks", () => {
    expect(parseAmountMinor("790.00")).toBe(79_000);
    expect(parseAmountMinor("790")).toBe(79_000);
    expect(parseAmountMinor("1.5")).toBe(150);
    expect(parseAmountMinor("-1.00")).toBe(-1);
    expect(parseAmountMinor("abc")).toBe(-1);
  });
});

describe("createPayment", () => {
  it("authenticates, uses the order id as the idempotence key and returns the payment page", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await createPayment(
      credentials,
      {
        orderId: "order-1",
        amountMinor: 79_000,
        currency: "RUB",
        description: "Mifluent Pro",
        returnUrl: "https://example.ru/settings?paid=1",
      },
      fakeFetch(
        200,
        {
          ...succeeded,
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yoomoney.ru/checkout/x" },
        },
        seen,
      ),
    );

    expect(result.confirmationUrl).toBe("https://yoomoney.ru/checkout/x");
    expect(seen.url).toBe("https://api.yookassa.ru/v3/payments");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers["Idempotence-Key"]).toBe("order-1");
    expect(headers["Authorization"]).toBe(
      `Basic ${Buffer.from(`${credentials.shopId}:${credentials.secretKey}`).toString("base64")}`,
    );
    const body = JSON.parse(String(seen.init?.body)) as Record<string, unknown>;
    expect(body["amount"]).toEqual({ value: "790.00", currency: "RUB" });
    expect(body["capture"]).toBe(true);
    expect(body["metadata"]).toEqual({ orderId: "order-1" });
  });

  it("fails loudly when ЮKassa refuses", async () => {
    await expect(
      createPayment(
        credentials,
        {
          orderId: "order-1",
          amountMinor: 100,
          currency: "RUB",
          description: "x",
          returnUrl: "https://example.ru",
        },
        fakeFetch(401, { type: "error", code: "invalid_credentials" }, {}),
      ),
    ).rejects.toMatchObject({ code: "payment_provider_failed" });
  });
});

describe("notifications", () => {
  it("takes only the payment id from the body", () => {
    expect(
      readNotificationPaymentId({
        type: "notification",
        event: "payment.succeeded",
        object: { id: "abc-123", status: "succeeded", amount: { value: "1.00" } },
      }),
    ).toBe("abc-123");
  });

  it("ignores anything that is not a payment notification", () => {
    expect(readNotificationPaymentId({ event: "payment.succeeded" })).toBeUndefined();
    expect(
      readNotificationPaymentId({
        type: "notification",
        event: "refund.succeeded",
        object: { id: "r-1" },
      }),
    ).toBeUndefined();
    expect(readNotificationPaymentId("nonsense")).toBeUndefined();
  });

  it("refuses to look up something that is not a payment id", async () => {
    await expect(
      fetchPayment(credentials, "../refunds", fakeFetch(200, succeeded, {})),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("outcomeOf", () => {
  it("turns a succeeded payment into a paid outcome for our order", () => {
    expect(outcomeOf(succeeded)).toEqual({
      eventKey: `${succeeded.id}:succeeded`,
      orderId: "0192a7c4-0000-7000-8000-000000000001",
      isPaid: true,
      paidAmountMinor: 79_000,
    });
  });

  it("reports a cancelled payment as not paid", () => {
    expect(outcomeOf({ ...succeeded, status: "canceled", paid: false })?.isPaid).toBe(false);
  });

  it("waits while the payment is still in progress", () => {
    expect(outcomeOf({ ...succeeded, status: "pending" })).toBeUndefined();
  });

  it("ignores a payment that names no order of ours", () => {
    expect(outcomeOf({ ...succeeded, metadata: {} })).toBeUndefined();
  });
});
