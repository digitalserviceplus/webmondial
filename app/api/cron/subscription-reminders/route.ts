import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = new Set([7, 5, 3, 0]);

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !supplied) return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Authentification cron invalide." }, { status: 401 });
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const reminderWindowEnd = new Date(todayUtc + 8 * DAY_MS - 1);
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIAL"] },
      currentPeriodEnd: { gte: new Date(todayUtc), lte: reminderWindowEnd },
    },
    select: {
      id: true,
      userId: true,
      tenantId: true,
      currentPeriodEnd: true,
      lastReminderDays: true,
    },
  });

  let remindersSent = 0;
  for (const subscription of subscriptions) {
    const end = subscription.currentPeriodEnd;
    const expiryUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const daysRemaining = Math.round((expiryUtc - todayUtc) / DAY_MS);
    if (!REMINDER_DAYS.has(daysRemaining) || subscription.lastReminderDays === daysRemaining) continue;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { id: subscription.id, lastReminderDays: subscription.lastReminderDays },
        data: { lastReminderDays: daysRemaining },
      });
      if (updated.count !== 1) return false;

      const timing = daysRemaining === 0 ? "aujourd’hui" : `dans ${daysRemaining} jours`;
      await tx.notification.create({
        data: {
          userId: subscription.userId,
          tenantId: subscription.tenantId,
          type: "SUBSCRIPTION",
          title: daysRemaining === 0 ? "Votre abonnement expire aujourd’hui" : `Votre abonnement expire dans ${daysRemaining} jours`,
          body: `Votre accès partenaire arrive à échéance ${timing}. Renouvelez-le pour conserver vos fonctionnalités de publication.`,
          href: "/dashboard?tab=subscription",
        },
      });
      return true;
    });
    if (result) remindersSent += 1;
  }

  const expired = await prisma.subscription.updateMany({
    where: {
      status: { in: ["ACTIVE", "TRIAL"] },
      currentPeriodEnd: { lt: new Date(todayUtc) },
    },
    data: { status: "EXPIRED" },
  });

  return NextResponse.json({ remindersSent, subscriptionsExpired: expired.count });
}
