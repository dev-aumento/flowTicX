import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  inrRupeesToPaise,
  planRequiresPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay";

describe("razorpay plan charges", () => {
  it("charges priced plans and skips trial and free plans", () => {
    expect(planRequiresPayment({ slug: "growth", amount: 999 })).toBe(true);
    expect(planRequiresPayment({ slug: "trial", amount: 499 })).toBe(false);
    expect(planRequiresPayment({ slug: "free", amount: 0 })).toBe(false);
  });

  it("converts rupees to paise", () => {
    expect(inrRupeesToPaise(999)).toBe(99900);
    expect(inrRupeesToPaise(0)).toBe(0);
    expect(inrRupeesToPaise(49.5)).toBe(4950);
  });

  it("accepts a payment signature made with the key secret", () => {
    const secret = "test-secret";
    const orderId = "order_123";
    const paymentId = "pay_456";
    const signature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyPaymentSignature(orderId, paymentId, signature, secret)).toBe(true);
    expect(verifyPaymentSignature(orderId, paymentId, signature, "other-secret")).toBe(false);
    expect(verifyPaymentSignature(orderId, "pay_other", signature, secret)).toBe(false);
  });

  it("accepts a webhook signature made from the raw body", () => {
    const secret = "whsec_test";
    const rawBody = '{"event":"payment.captured"}';
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    expect(verifyWebhookSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(`${rawBody} `, signature, secret)).toBe(false);
  });
});
