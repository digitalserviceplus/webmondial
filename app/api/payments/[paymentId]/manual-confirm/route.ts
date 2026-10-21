import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { settlePayment } from "@/lib/payments/settle";
import { isEffectivelyPaid } from "@/lib/publications";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });
  }

  const { paymentId } = await params;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      provider: true,
      type: true,
      status: true,
      tenant: { select: { id: true, ownerId: true } },
      metadata: true,
    },
  });
  if (!payment || payment.type !== "PAID_PUBLICATION" || payment.provider !== "manual" || !payment.tenant) {
    return NextResponse.json({ error: "Demande de paiement manuel introuvable." }, { status: 404 });
  }
  if (session.user.role === "ADMIN" && payment.tenant.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Cette demande appartient à un autre espace." }, { status: 403 });
  }
  if (payment.status !== "PENDING") {
    return NextResponse.json({ error: "Cette demande a déjà été traitée." }, { status: 409 });
  }
  const postId = payment.metadata && typeof payment.metadata === "object" && "postId" in payment.metadata
    ? payment.metadata.postId
    : null;
  const post = typeof postId === "string"
    ? await prisma.post.findFirst({
        where: { id: postId, tenantId: payment.tenant.id, visibility: "PAID", status: "ACTIVE", published: true },
        select: { id: true, price: true },
      })
    : null;
  if (!post || !isEffectivelyPaid("PAID", post.price)) {
    return NextResponse.json({ error: "La publication associée à ce paiement n’est plus disponible." }, { status: 409 });
  }

  const result = await settlePayment(payment.id, "SUCCEEDED", "MANUAL", undefined, undefined, session.user.id);
  if (result.kind === "missing") return NextResponse.json({ error: "Demande de paiement introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, status: result.status });
}
