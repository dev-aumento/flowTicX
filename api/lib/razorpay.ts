import { createHmac, timingSafeEqual } from "node:crypto";

const ORDER_URL = "https://api.razorpay.com/v1/orders";

export type RazorpayKeys = {
  keyId: string;
  keySecret: string;
};

export function readRazorpayKeys(): RazorpayKeys | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function readRazorpayWebhookSecret() {
  return process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";
}

/** Trial and zero-rupee plans start without a charge. */
export function planRequiresPayment(plan: { slug: string; amount: number }) {
  if (plan.slug.trim().toLowerCase() === "trial") return false;
  return Number(plan.amount) > 0;
}

/** Razorpay charges in paise. ₹1 is the smallest order. */
export function inrRupeesToPaise(amount: number) {
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees <= 0) return 0;
  return Math.round(rupees * 100);
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

function safeEqualHex(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
};

export async function createRazorpayOrder(input: {
  keys: RazorpayKeys;
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const auth = Buffer.from(`${input.keys.keyId}:${input.keys.keySecret}`).toString("base64");
  const response = await fetch(ORDER_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  } | null;

  if (!response.ok || !body?.id) {
    const description = body?.error?.description?.trim();
    throw new Error(description || "Razorpay could not start this payment.");
  }

  return {
    id: body.id,
    amount: typeof body.amount === "number" ? body.amount : input.amountPaise,
    currency: body.currency || "INR",
  };
}
