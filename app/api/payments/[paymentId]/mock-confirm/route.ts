import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { settlePayment } from "@/lib/payments/settle";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const resultSchema = z.object({ result: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  if (process.env.NODE_ENV === "production" || process.env.PAYMENT_MODE !== "mock") {
    return NextResponse.json({ error: "Le simulateur de paiement est désactivé." }, { status: 404 });
  }
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (!(await rateLimit(requestKey(request, `mock-payment:${session.user.id}`), 10, 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives." }, { status: 429 });
  }
  const parsed = resultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Résultat de test invalide." }, { status: 400 });
  const { paymentId } = await params;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: session.user.id, provider: "mock" },
    select: { id: true },
  });
  if (!payment) return NextResponse.json({ error: "Transaction introuvable." }, { status: 404 });
  const result = await settlePayment(payment.id, parsed.data.result, "MOCK");

  if (result.kind === "missing") return NextResponse.json({ error: "Transaction introuvable." }, { status: 404 });
  if (result.kind === "already-processed") return NextResponse.json({ error: "Cette transaction a déjà été traitée." }, { status: 409 });
  return NextResponse.json({ ok: true, status: result.status });
}
