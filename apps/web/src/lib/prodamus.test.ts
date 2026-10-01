import { describe, expect, it } from "vitest";
import {
  buildPaymentLink,
  isValidSignature,
  parseFormBody,
  readNotification,
  signForm,
} from "./prodamus.js";

const SECRET = "test-secret-0123456789abcdef";

const paidBody = new URLSearchParams({
  order_id: "pd-1001",
  order_num: "0192ab3c-4d5e-7f00-8a1b-2c3d4e5f6a7b",
  sum: "790.00",
  payment_status: "success",
  "products[0][name]": "Mifluent Pro, 1 month",
  "products[0][price]": "790.00",
  customer_email: "owner@example.com",
}).toString();

describe("parseFormBody", () => {
  it("nests bracketed keys the way the provider's libraries do", () => {
    const tree = parseFormBody("products[0][name]=Pro&products[0][price]=790&sum=790");

    expect(tree).toEqual({ products: { "0": { name: "Pro", price: "790" } }, sum: "790" });
  });
});

describe("parseFormBody with a hostile body", () => {
  it("does not let a field reach the object prototype", () => {
    parseFormBody("__proto__[isAdmin]=1&constructor[prototype][isAdmin]=1&sum=1");

    expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
  });
});

describe("signatures", () => {
  it("accepts a body signed with the shop's secret", () => {
    const tree = parseFormBody(paidBody);

    expect(isValidSignature(tree, signForm(tree, SECRET), SECRET)).toBe(true);
  });

  it("refuses a body changed after signing", () => {
    const tree = parseFormBody(paidBody);
    const signature = signForm(tree, SECRET);
    const tampered = parseFormBody(paidBody.replace("790.00", "1.00"));

    expect(isValidSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    const tree = parseFormBody(paidBody);

    expect(isValidSignature(tree, signForm(tree, "another-secret-xxxxxxxx"), SECRET)).toBe(false);
  });

  it("refuses a missing signature", () => {
    expect(isValidSignature(parseFormBody(paidBody), null, SECRET)).toBe(false);
  });

  it("does not depend on the order the fields arrived in", () => {
    const reordered = parseFormBody(paidBody.split("&").reverse().join("&"));

    expect(signForm(reordered, SECRET)).toBe(signForm(parseFormBody(paidBody), SECRET));
  });
});

describe("readNotification", () => {
  it("reads our order id, the amount in kopecks and the paid status", () => {
    const notification = readNotification(parseFormBody(paidBody));

    expect(notification).toEqual({
      eventKey: "pd-1001:success",
      orderId: "0192ab3c-4d5e-7f00-8a1b-2c3d4e5f6a7b",
      isPaid: true,
      paidAmountMinor: 79_000,
    });
  });

  it("treats any status but success as unpaid", () => {
    const failed = readNotification(parseFormBody(paidBody.replace("success", "order_denied")));

    expect(failed?.isPaid).toBe(false);
  });

  it("ignores a notification that names no order", () => {
    expect(readNotification(parseFormBody("sum=790"))).toBeUndefined();
  });
});

describe("buildPaymentLink", () => {
  it("puts our order id and the price on the shop's payment page", () => {
    const link = new URL(
      buildPaymentLink({
        shopUrl: "https://myshop.payform.ru",
        orderId: "order-1",
        amount: 3790,
        productName: "Mifluent Pro, 12 months",
        customerEmail: null,
        notificationUrl: "https://app.example/api/billing/prodamus",
        successUrl: "https://app.example/settings?paid=1",
        returnUrl: "https://app.example/pricing",
      }),
    );

    expect(link.hostname).toBe("myshop.payform.ru");
    expect(link.searchParams.get("order_id")).toBe("order-1");
    expect(link.searchParams.get("products[0][price]")).toBe("3790.00");
    expect(link.searchParams.has("customer_email")).toBe(false);
  });
});
