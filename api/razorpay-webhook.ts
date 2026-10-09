import type { Context } from "hono";
import { fulfillSubscriptionCheckout } from "./lib/subscription-checkout";
import { readRazorpayWebhookSecret, verifyWebhookSignature } from "./lib/razorpay";

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    order?: { entity?: { id?: string; amount?: number } };
  };
};

/** Confirms a captured payment if the browser closed before checkout returned. */
export async function razorpayWebhookHandler(c: Context) {
  const rawBody = await c.req.text();
  const secret = readRazorpayWebhookSecret();
  if (!secret) {
    console.error("[razorpay] Webhook ignored because RAZORPAY_WEBHOOK_SECRET is not set");
    return c.json({ ok: false }, 503);
  }

  const signature = c.req.header("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const event = body.event ?? "";
  if (event !== "payment.captured" && event !== "order.paid") {
    return c.json({ ok: true });
  }

  const payment = body.payload?.payment?.entity;
  const orderId = payment?.order_id || body.payload?.order?.entity?.id || "";
  const paymentId = payment?.id || "";
  if (!orderId || !paymentId) {
    return c.json({ ok: true });
  }
  if (payment?.status && payment.status !== "captured" && event === "payment.captured") {
    return c.json({ ok: true });
  }

  try {
    await fulfillSubscriptionCheckout({
      orderId,
      paymentId,
      amountPaise: typeof payment?.amount === "number" ? payment.amount : undefined,
    });
  } catch (error) {
    console.error("[razorpay] Webhook could not activate the plan:", error);
    return c.json({ error: "Could not record payment" }, 500);
  }

  return c.json({ ok: true });
}
