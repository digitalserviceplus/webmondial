import type { PaymentStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type PaymentOutcome = Extract<PaymentStatus, "SUCCEEDED" | "FAILED" | "CANCELLED">;

export async function settlePayment(
  paymentId: string,
  outcome: PaymentOutcome,
  source: "SASPAY" | "MOCK",
  idempotencyKey?: string,
) {
  return prisma.$transaction(async (tx) => {
    if (idempotencyKey) {
      const prior = await tx.auditLog.findFirst({
        where: { action: "PAYMENT_SETTLED", target: idempotencyKey },
        select: { id: true },
      });
      if (prior) return { kind: "already-processed" as const, status: outcome };
    }
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        tenantId: true,
        subscriptionId: true,
        type: true,
        status: true,
        months: true,
        metadata: true,
      },
    });
    if (!payment) return { kind: "missing" as const };
    if (payment.status !== "PENDING") return { kind: "already-processed" as const, status: payment.status };

    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: outcome, processedAt: new Date() },
    });
    if (changed.count !== 1) return { kind: "already-processed" as const };

    if (outcome === "SUCCEEDED" && payment.type === "PARTNER_SUBSCRIPTION") {
      if (!payment.tenantId || !payment.months) throw new Error("Subscription payment is missing its tenant or duration.");
      const subscription = await tx.subscription.findUnique({
        where: { tenantId: payment.tenantId },
        include: { plan: true },
      });
      if (!subscription) throw new Error("Subscription not found for payment.");
      const now = new Date();
      const base = subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
      const periodEnd = new Date(base);
      if (payment.months === 1) {
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 30 + subscription.plan.singleMonthBonusDays);
      } else {
        const months = payment.months + subscription.plan.multiMonthBonus;
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + months);
      }
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: base,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
          paidMonths: subscription.paidMonths + payment.months,
          lastReminderDays: null,
        },
      });
    }

    if (outcome === "SUCCEEDED" && payment.type === "PAID_PUBLICATION") {
      const postId = payment.metadata && typeof payment.metadata === "object" && "postId" in payment.metadata
        ? payment.metadata.postId
        : null;
      if (typeof postId !== "string") throw new Error("Paid publication reference is missing.");
      await tx.publicationPurchase.upsert({
        where: { postId_userId: { postId, userId: payment.userId } },
        create: { postId, userId: payment.userId, paymentId: payment.id },
        update: {},
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: payment.userId,
        tenantId: payment.tenantId,
        action: idempotencyKey ? "PAYMENT_SETTLED" : `${source}_PAYMENT_${outcome}`,
        target: idempotencyKey ?? payment.id,
        metadata: { paymentId: payment.id, source, outcome },
      },
    });
    return { kind: "processed" as const, status: outcome };
  });
}
