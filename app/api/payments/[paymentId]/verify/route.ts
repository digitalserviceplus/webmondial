import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { settlePayment } from "@/lib/payments/settle";
import { getPaymentProvider, SasPayPaymentProvider } from "@/lib/payments/provider";
import { rateLimit, requestKey } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (!(await rateLimit(requestKey(request, `payment-verify:${session.user.id}`), 12, 60_000))) {
    return NextResponse.json({ error: "Trop de vérifications. Réessayez dans une minute." }, { status: 429 });
  }
  const { paymentId } = await params;
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: session.user.id },
    select: { id: true, provider: true, providerPaymentId: true, status: true, amount: true, currency: true },
  });
  if (!payment) return NextResponse.json({ error: "Transaction introuvable." }, { status: 404 });
  if (payment.status !== "PENDING") return NextResponse.json({ status: payment.status });
  if (payment.provider !== "saspay" || !payment.providerPaymentId) {
    return NextResponse.json({ error: "Aucune session SasPay vérifiable n’est associée à cette transaction." }, { status: 409 });
  }

  try {
    const provider = getPaymentProvider();
    if (!(provider instanceof SasPayPaymentProvider)) {
      return NextResponse.json({ error: "Le fournisseur SasPay n’est pas activé." }, { status: 503 });
    }
    const verified = await provider.verifyCheckout(payment.providerPaymentId, {
      amount: payment.amount,
      currency: payment.currency,
    });
    if (verified.status === "PENDING") return NextResponse.json({ status: "PENDING" });
    const settled = await settlePayment(
      payment.id,
      verified.status,
      "SASPAY",
      `SasPay:${payment.providerPaymentId}:${verified.status}`,
    );
    if (settled.kind === "missing") return NextResponse.json({ error: "Transaction introuvable." }, { status: 404 });
    return NextResponse.json({ status: settled.kind === "processed" ? settled.status : payment.status });
  } catch (cause) {
    console.error("SasPay payment verification failed.", {
      paymentId,
      error: cause instanceof Error ? cause.message : "Unknown provider error.",
    });
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Impossible de vérifier le paiement auprès de SasPay." },
      { status: 502 },
    );
  }
}
