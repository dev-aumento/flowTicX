const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export class RazorpayCheckoutClosed extends Error {
  constructor() {
    super("Payment cancelled");
    this.name = "RazorpayCheckoutClosed";
  }
}

export type RazorpayCheckoutSession = {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
};

export type RazorpayPaymentProof = {
  orderId: string;
  paymentId: string;
  signature: string;
};

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayFailure = {
  error?: { description?: string };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (payload: RazorpayFailure) => void) => void;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Razorpay checkout could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export function openRazorpayCheckout(session: RazorpayCheckoutSession) {
  return loadRazorpayScript().then(
    () =>
      new Promise<RazorpayPaymentProof>((resolve, reject) => {
        const Razorpay = window.Razorpay;
        if (!Razorpay) {
          reject(new Error("Razorpay checkout could not be loaded."));
          return;
        }

        let settled = false;
        const checkout = new Razorpay({
          key: session.keyId,
          amount: session.amount,
          currency: session.currency,
          name: session.name,
          description: session.description,
          order_id: session.orderId,
          prefill: session.prefill,
          theme: { color: "#2563EB" },
          handler(response: RazorpaySuccess) {
            if (settled) return;
            settled = true;
            resolve({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });
          },
          modal: {
            ondismiss() {
              window.setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new RazorpayCheckoutClosed());
              }, 400);
            },
          },
        });

        checkout.on("payment.failed", (payload) => {
          if (settled) return;
          settled = true;
          reject(new Error(payload.error?.description || "Payment failed."));
        });
        checkout.open();
      }),
  );
}

function isPaymentSession(
  value: { requiresPayment: boolean },
): value is RazorpayCheckoutSession & { requiresPayment: true } {
  return value.requiresPayment === true;
}

export async function completePlanCheckout<T extends { requiresPayment: boolean }>(
  slug: string,
  beginCheckout: (input: { slug: string }) => Promise<T>,
  confirmPayment: (input: RazorpayPaymentProof) => Promise<Extract<T, { requiresPayment: false }>>,
): Promise<Extract<T, { requiresPayment: false }>> {
  const started = await beginCheckout({ slug });
  if (isPaymentSession(started)) {
    const proof = await openRazorpayCheckout(started);
    return confirmPayment(proof);
  }
  return started as Extract<T, { requiresPayment: false }>;
}
