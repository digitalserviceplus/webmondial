import { z } from "zod";

export type PaymentCheckoutRequest = {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  customerName: string;
  returnUrl: string;
  country?: string;
};

export type PaymentCheckoutResult = {
  provider: "mock" | "saspay";
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  status: "PENDING";
};

export type VerifiedCheckout = {
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  amount?: number;
  currency?: string;
  providerTransactionId?: string;
};

export interface PaymentProvider {
  createCheckout(input: PaymentCheckoutRequest): Promise<PaymentCheckoutResult>;
  verifyCheckout(providerPaymentId: string, expected: { amount: number; currency: string }): Promise<VerifiedCheckout>;
}

class MockPaymentProvider implements PaymentProvider {
  async createCheckout(): Promise<PaymentCheckoutResult> {
    return { provider: "mock", providerPaymentId: null, checkoutUrl: null, status: "PENDING" };
  }

  async verifyCheckout(): Promise<VerifiedCheckout> {
    throw new Error("Les paiements de test ne passent pas par la vérification SasPay.");
  }
}

const checkoutStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  transaction_id: z.string().uuid().nullable().optional(),
  transaction_status: z.string().nullable().optional(),
});

const transactionVerificationSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  requested_amount: z.string(),
  currency: z.string().length(3),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseData(payload: unknown, status: number): Record<string, unknown> {
  const envelope = asRecord(payload);
  if (!envelope) throw new Error(`Réponse SasPay invalide (HTTP ${status}).`);
  if (envelope.success === false) {
    const error = asRecord(envelope.error);
    const code = typeof error?.code === "string" ? `, ${error.code}` : "";
    throw new Error(`SasPay a refusé la requête (HTTP ${status}${code}).`);
  }
  const data = asRecord(envelope.data);
  return data ?? envelope;
}

function normalizeAmount(value: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const integer = match[1].replace(/^0+(?=\d)/, "");
  return `${integer}.${(match[2] ?? "").padEnd(2, "0")}`;
}

export class SasPayPaymentProvider implements PaymentProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiBaseUrl = "https://api.saspay.me/api/v1",
  ) {}

  async createCheckout(input: PaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const payload = await this.request("/checkout-sessions/", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description: input.description,
        customer_email: input.customerEmail,
        customer_name: input.customerName,
        ...(input.country ? { country: input.country } : {}),
        return_url: input.returnUrl,
        metadata: { webmondial_payment_id: input.paymentId },
      }),
    });
    const parsed = z.object({
      id: z.string().uuid(),
      checkout_url: z.string().url(),
      status: z.literal("PENDING"),
    }).safeParse(payload);
    if (!parsed.success) throw new Error("SasPay a renvoyé une session de paiement incomplète.");
    const url = new URL(parsed.data.checkout_url);
    const isSasPayHost = url.hostname === "saspay.me" || url.hostname.endsWith(".saspay.me");
    if (
      url.protocol !== "https:" ||
      !isSasPayHost ||
      url.username ||
      url.password
    ) {
      throw new Error("SasPay a renvoyé une URL de paiement non autorisée.");
    }
    return {
      provider: "saspay",
      providerPaymentId: parsed.data.id,
      checkoutUrl: parsed.data.checkout_url,
      status: "PENDING",
    };
  }

  async verifyCheckout(
    providerPaymentId: string,
    expected: { amount: number; currency: string },
  ): Promise<VerifiedCheckout> {
    const rawStatus = await this.request(
      `/checkout-sessions/${encodeURIComponent(providerPaymentId)}/status/`,
      { method: "GET" },
    );
    const checkout = checkoutStatusSchema.safeParse(rawStatus);
    if (!checkout.success) throw new Error("SasPay a renvoyé un statut de checkout invalide.");
    const transactionStatus = checkout.data.transaction_status;
    if (transactionStatus === "PENDING" || (!transactionStatus && checkout.data.status === "PENDING")) {
      return { status: "PENDING" };
    }
    if (transactionStatus === "FAILED") return { status: "FAILED" };
    if (transactionStatus === "CANCELLED") return { status: "CANCELLED" };
    if (transactionStatus !== "SUCCESS" || !checkout.data.transaction_id) {
      throw new Error("SasPay n’a pas fourni de transaction vérifiable pour ce checkout.");
    }

    const rawTransaction = await this.request(
      `/payments/${encodeURIComponent(checkout.data.transaction_id)}/verify/`,
      { method: "GET" },
    );
    const transaction = transactionVerificationSchema.safeParse(rawTransaction);
    if (!transaction.success) throw new Error("SasPay a renvoyé une vérification de paiement invalide.");
    if (transaction.data.id !== checkout.data.transaction_id) {
      throw new Error("La transaction vérifiée par SasPay ne correspond pas à ce checkout.");
    }
    if (transaction.data.status === "PENDING") return { status: "PENDING" };
    if (transaction.data.status === "FAILED") return { status: "FAILED" };
    if (transaction.data.status !== "SUCCESS") {
      throw new Error("SasPay a renvoyé un statut de paiement inconnu.");
    }
    const verifiedAmount = normalizeAmount(transaction.data.requested_amount);
    if (!verifiedAmount || Number(verifiedAmount) <= 0) {
      throw new Error("SasPay a renvoyé un montant vérifié invalide.");
    }
    if (
      transaction.data.currency === expected.currency &&
      verifiedAmount !== normalizeAmount(expected.amount.toFixed(2))
    ) {
      throw new Error("Le montant ou la devise vérifiés par SasPay ne correspondent pas au paiement.");
    }
    return {
      status: "SUCCEEDED",
      amount: Number(verifiedAmount),
      currency: transaction.data.currency,
      providerTransactionId: transaction.data.id,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = asRecord(body);
      const error = asRecord(envelope?.error);
      const code = typeof error?.code === "string" ? `, ${error.code}` : "";
      throw new Error(`La requête SasPay a échoué (HTTP ${response.status}${code}).`);
    }
    return responseData(body, response.status);
  }
}

export function getPaymentProvider(): PaymentProvider {
  const apiKey = process.env.SASPAY_API_KEY?.trim() || process.env.SASPAY_SECRET_KEY?.trim();
  if (apiKey) return new SasPayPaymentProvider(apiKey);
  if (process.env.PAYMENT_MODE === "mock" && process.env.NODE_ENV !== "production") return new MockPaymentProvider();
  throw new Error("Configurez SASPAY_API_KEY côté serveur pour activer les paiements réels.");
}
