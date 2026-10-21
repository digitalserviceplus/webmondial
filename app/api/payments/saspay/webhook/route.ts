import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider, SasPayPaymentProvider } from "@/lib/payments/provider";
import { settlePayment } from "@/lib/payments/settle";
import { isValidSasPayWebhookSignature } from "@/lib/payments/webhook-signature";

const webhookSchema = z.object({
  event: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const secret = process.env.SASPAY_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Le secret du webhook SasPay n’est pas configuré." }, { status: 503 });
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) return NextResponse.json({ error: "Événement trop volumineux." }, { status: 413 });

  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  const eventHeader = request.headers.get("x-webhook-event");
  if (!isValidSasPayWebhookSignature(rawBody, signature, timestamp, secret)) {
    return NextResponse.json({ error: "Signature de webhook invalide ou expirée." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success || !eventHeader || parsed.data.event !== eventHeader) {
    return NextResponse.json({ error: "Événement SasPay invalide." }, { status: 400 });
  }
  if (parsed.data.event === "webhook.test" || parsed.data.event === "transaction.created") {
    return NextResponse.json({ received: true });
  }
  if (!["transaction.success", "transaction.failed", "transaction.cancelled"].includes(parsed.data.event)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const metadata = parsed.data.data.metadata;
  const paymentId = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "webmondial_payment_id" in metadata
    ? metadata.webmondial_payment_id
    : null;
  if (typeof paymentId !== "string") {
    console.warn("A verified SasPay transaction webhook could not be correlated to a local payment.", {
      event: parsed.data.event,
      providerTransactionId: parsed.data.data.id,
    });
    return NextResponse.json({
      received: true,
      reconciled: false,
      message: "Le statut sera confirmé lors du retour du client ou d’une vérification manuelle.",
    }, { status: 202 });
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "saspay" },
    select: { id: true, status: true, providerPaymentId: true, amount: true, currency: true },
  });
  if (!payment) return NextResponse.json({ error: "Paiement local introuvable." }, { status: 503 });
  if (payment.status !== "PENDING") return NextResponse.json({ received: true, reconciled: true });
  if (!payment.providerPaymentId) {
    return NextResponse.json({ error: "La session SasPay n’est pas encore enregistrée." }, { status: 503 });
  }

  try {
    const provider = getPaymentProvider();
    if (!(provider instanceof SasPayPaymentProvider)) {
      return NextResponse.json({ error: "Le fournisseur SasPay n’est pas activé." }, { status: 503 });
    }
    const verified = await provider.verifyCheckout(payment.providerPaymentId, {
      amount: Number(payment.amount),
      currency: payment.currency,
    });
    if (verified.status === "PENDING") {
      return NextResponse.json({ error: "SasPay confirme encore le paiement comme en attente." }, { status: 503 });
    }
    const settled = await settlePayment(
      payment.id,
      verified.status,
      "SASPAY",
      `SasPay:${payment.providerPaymentId}:${verified.status}`,
      verified,
    );
    if (settled.kind === "missing") return NextResponse.json({ error: "Paiement local introuvable." }, { status: 503 });
    return NextResponse.json({ received: true, reconciled: true });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      return NextResponse.json({ received: true, reconciled: true });
    }
    console.error("SasPay webhook reconciliation failed.", {
      paymentId,
      error: cause instanceof Error ? cause.message : "Unknown provider error.",
    });
    return NextResponse.json({ error: "Le statut SasPay n’a pas pu être vérifié." }, { status: 503 });
  }
}
