import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPartnerTrialEndDate } from "@/lib/subscriptions";

const acceptanceSchema = z.object({ accepted: z.literal(true) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const parsed = acceptanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "L’acceptation du contrat est requise." }, { status: 400 });

  const tenant = await prisma.tenant.findFirst({
    where: { ownerId: session.user.id, status: "PENDING" },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: "Aucun espace en attente de contrat." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    const agreement = await tx.partnershipAgreement.findUnique({
      where: { tenantId: tenant.id },
      select: { id: true, acceptedAt: true, tenant: { select: { subscription: { select: { id: true } } } } },
    });
    if (!agreement) throw new Error("Approved partner agreement was not found.");
    if (!agreement.acceptedAt) {
      await tx.partnershipAgreement.update({
        where: { id: agreement.id },
        data: {
          acceptedAt: new Date(),
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        },
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });
      const now = new Date();
      const subscription = agreement.tenant.subscription;
      if (!subscription) throw new Error("Partner subscription was not created.");
      const trialEndsAt = getPartnerTrialEndDate(now);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "TRIAL",
          trialStartedAt: now,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
        },
      });
      await tx.notification.create({
        data: {
          userId: session.user.id,
          tenantId: tenant.id,
          type: "PARTNERSHIP",
          title: "Votre espace partenaire est activé",
          body: "Votre période gratuite de 7 jours a commencé. Vous pouvez dès maintenant publier et gérer votre espace.",
          href: "/dashboard?tab=posts",
        },
      });
      await tx.auditLog.create({
        data: { actorId: session.user.id, tenantId: tenant.id, action: "PARTNER_AGREEMENT_ACCEPTED" },
      });
    }
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  }
  const agreement = await prisma.partnershipAgreement.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { version: true, content: true, acceptedAt: true, createdAt: true },
  });
  return NextResponse.json({ agreement });
}
