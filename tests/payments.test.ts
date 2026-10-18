import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { SasPayPaymentProvider } from "../lib/payments/provider";
import { isValidSasPayWebhookSignature } from "../lib/payments/webhook-signature";
import { calculateSubscription, canPublishContent, canPublishPaidContent } from "../lib/subscriptions";

const checkoutSessionId = "c9a17e2c-4b1a-4f0e-9c3d-2a1b3c4d5e6f";
const transactionId = "9c3f2a10-4b7e-4f1a-9d2e-9b6a7c1e4a02";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("SasPay checkout uses the documented hosted-session fields and keeps the key server-side", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const provider = new SasPayPaymentProvider("sk_test_example", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return response({
      id: checkoutSessionId,
      checkout_url: "https://pay.saspay.me/checkout/checkout-slug",
      status: "PENDING",
    }, 201);
  });

  const result = await provider.createCheckout({
    paymentId: "local-payment-id",
    amount: 2500,
    currency: "XOF",
    description: "Abonnement partenaire",
    customerEmail: "player@example.com",
    customerName: "Awa Sossou",
    country: "BJ",
    returnUrl: "https://webmondial.example/paiement/retour?paymentId=local-payment-id",
  });

  assert.equal(requestUrl, "https://api.saspay.me/api/v1/checkout-sessions/");
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer sk_test_example");
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(body.amount, "2500.00");
  assert.equal(body.customer_email, "player@example.com");
  assert.equal(body.customer_name, "Awa Sossou");
  assert.equal(body.country, "BJ");
  assert.deepEqual(body.metadata, { webmondial_payment_id: "local-payment-id" });
  assert.equal(result.providerPaymentId, checkoutSessionId);
  assert.equal(result.checkoutUrl, "https://pay.saspay.me/checkout/checkout-slug");
});

test("SasPay checkout leaves country selection to SasPay when no country is known", async () => {
  let requestInit: RequestInit | undefined;
  const provider = new SasPayPaymentProvider("sk_test_example", async (_input, init) => {
    requestInit = init;
    return response({
      id: checkoutSessionId,
      checkout_url: "https://pay.saspay.me/checkout/checkout-slug",
      status: "PENDING",
    }, 201);
  });
  await provider.createCheckout({
    paymentId: "local-payment-id",
    amount: 2500,
    currency: "XOF",
    description: "Abonnement partenaire",
    customerEmail: "player@example.com",
    customerName: "Awa Sossou",
    returnUrl: "https://webmondial.example/paiement/retour",
  });
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal("country" in body, false);
});

test("SasPay checkout accepts provider-owned payment hosts and rejects lookalike domains", async () => {
  const input = {
    paymentId: "local-payment-id",
    amount: 2500,
    currency: "XOF",
    description: "Abonnement partenaire",
    customerEmail: "player@example.com",
    customerName: "Awa Sossou",
    returnUrl: "https://webmondial.example/paiement/retour?paymentId=local-payment-id",
  };
  const createProviderForUrl = (checkoutUrl: string) => new SasPayPaymentProvider(
    "sk_test_example",
    async () => response({ id: checkoutSessionId, checkout_url: checkoutUrl, status: "PENDING" }, 201),
  );

  const checkout = await createProviderForUrl("https://checkout.saspay.me/pay/session?token=abc").createCheckout(input);
  assert.equal(checkout.checkoutUrl, "https://checkout.saspay.me/pay/session?token=abc");
  await assert.rejects(
    createProviderForUrl("https://pay.saspay.me.example.org/checkout/session").createCheckout(input),
    /URL de paiement non autorisée/,
  );
  await assert.rejects(
    createProviderForUrl("http://pay.saspay.me/checkout/session").createCheckout(input),
    /URL de paiement non autorisée/,
  );
});

test("SasPay verification confirms a payment only after checking the transaction amount and currency", async () => {
  const urls: string[] = [];
  const provider = new SasPayPaymentProvider("sk_test_example", async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith(`/checkout-sessions/${checkoutSessionId}/status/`)) {
      return response({
        id: checkoutSessionId,
        status: "PAID",
        transaction_id: transactionId,
        transaction_status: "SUCCESS",
      });
    }
    return response({
      success: true,
      data: { id: transactionId, status: "SUCCESS", requested_amount: "2500.00", currency: "XOF" },
      code: 200,
    });
  });

  const result = await provider.verifyCheckout(checkoutSessionId, { amount: 2500, currency: "XOF" });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(urls, [
    `https://api.saspay.me/api/v1/checkout-sessions/${checkoutSessionId}/status/`,
    `https://api.saspay.me/api/v1/payments/${transactionId}/verify/`,
  ]);
});

test("SasPay verification leaves pending sessions unpaid and rejects amount mismatches", async () => {
  const pendingProvider = new SasPayPaymentProvider("sk_test_example", async () =>
    response({ id: checkoutSessionId, status: "PENDING", transaction_status: "PENDING" }),
  );
  assert.deepEqual(
    await pendingProvider.verifyCheckout(checkoutSessionId, { amount: 2500, currency: "XOF" }),
    { status: "PENDING" },
  );

  const mismatchedProvider = new SasPayPaymentProvider("sk_test_example", async (input) =>
    String(input).includes("/checkout-sessions/")
      ? response({ id: checkoutSessionId, status: "PAID", transaction_id: transactionId, transaction_status: "SUCCESS" })
      : response({ id: transactionId, status: "SUCCESS", requested_amount: "2499.00", currency: "XOF" }),
  );
  await assert.rejects(
    mismatchedProvider.verifyCheckout(checkoutSessionId, { amount: 2500, currency: "XOF" }),
    /montant ou la devise/,
  );
});

test("SasPay webhook signatures are timestamp-bound and compared against the raw body", () => {
  const secret = "webhook-test-secret";
  const timestamp = "1700000000";
  const rawBody = '{"event":"transaction.success","data":{"id":"abc"}}';
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const now = Number(timestamp) * 1000;

  assert.equal(isValidSasPayWebhookSignature(rawBody, signature, timestamp, secret, now), true);
  assert.equal(isValidSasPayWebhookSignature(`${rawBody} `, signature, timestamp, secret, now), false);
  assert.equal(isValidSasPayWebhookSignature(rawBody, signature, timestamp, secret, now + 301_000), false);
  assert.equal(isValidSasPayWebhookSignature(rawBody, "0".repeat(64), timestamp, secret, now), false);
});

test("paid publication access requires an active subscription and a recent single annual payment", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const activeSubscription = {
    status: "ACTIVE",
    currentPeriodEnd: new Date("2026-11-17T12:00:00.000Z"),
  };

  assert.equal(
    canPublishPaidContent(activeSubscription, new Date("2026-01-17T12:00:00.000Z"), now),
    true,
  );
  assert.equal(
    canPublishPaidContent(activeSubscription, new Date("2025-09-16T12:00:00.000Z"), now),
    false,
  );
  assert.equal(
    canPublishPaidContent(activeSubscription, null, now),
    false,
  );
  assert.equal(
    canPublishPaidContent({ ...activeSubscription, status: "EXPIRED" }, new Date("2026-01-17T12:00:00.000Z"), now),
    false,
  );
});

test("partner subscription pricing applies the one-month and multi-month bonuses", () => {
  assert.deepEqual(calculateSubscription(2000, 1), {
    amount: 2000,
    currency: "XOF",
    paidMonths: 1,
    bonusDays: 7,
    bonusMonths: 0,
    totalMonths: 1,
  });
  assert.deepEqual(calculateSubscription(2000, 2), {
    amount: 4000,
    currency: "XOF",
    paidMonths: 2,
    bonusDays: 0,
    bonusMonths: 1,
    totalMonths: 3,
  });
  assert.equal(calculateSubscription(2000, 12).amount, 24000);
  assert.equal(calculateSubscription(2000, 12).totalMonths, 13);
});

test("partner publishing is allowed only during a live trial or paid period", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  assert.equal(
    canPublishContent({
      status: "TRIAL",
      trialEndsAt: new Date("2026-10-20T12:00:00.000Z"),
      currentPeriodEnd: new Date("2026-10-20T12:00:00.000Z"),
    }, now),
    true,
  );
  assert.equal(
    canPublishContent({
      status: "TRIAL",
      trialEndsAt: new Date("2026-10-17T11:59:59.000Z"),
      currentPeriodEnd: new Date("2026-10-20T12:00:00.000Z"),
    }, now),
    false,
  );
  assert.equal(
    canPublishContent({
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-18T12:00:00.000Z"),
    }, now),
    true,
  );
  assert.equal(
    canPublishContent({
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-17T11:59:59.000Z"),
    }, now),
    false,
  );
  assert.equal(canPublishContent(null, now), false);
});
