import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision invalide." }, { status: 400 });
  const { applicationId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const application = await tx.partnershipApplication.findUnique({
      where: { id: applicationId },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    if (!application || application.status !== "PENDING") return null;
    if (parsed.data.decision === "REJECTED") {
      await tx.partnershipApplication.update({
        where: { id: application.id },
        data: { status: "REJECTED", reviewerId: session.user.id, reviewedAt: new Date() },
      });
      return { tenant: null };
    }
    if (application.user.role !== "PLAYER" && application.user.role !== "SUPER_ADMIN") {
      throw new Error("Only player accounts and the general admin can become partners.");
    }
    const plan = await tx.subscriptionPlan.upsert({
      where: { id: "default-partner-plan" },
      create: { id: "default-partner-plan", name: "Partenaire", monthlyPrice: 200, currency: "XOF", trialDays: 3 },
      update: {},
    });
    const tenant = await tx.tenant.create({
      data: {
        ownerId: application.userId,
        handle: application.requestedHandle,
        displayName: application.requestedDisplayName,
        bio: application.bio,
        status: "PENDING",
      },
    });
    const configuredContract = await tx.systemSetting.findUnique({
      where: { key: "partner-contract" },
      select: { value: true },
    });
    const contractData = configuredContract?.value;
    const contract =
      contractData && typeof contractData === "object" && "content" in contractData && typeof contractData.content === "string"
        ? contractData.content
        : "En utilisant cet espace, le partenaire s’engage à respecter les règles de la plateforme, publier des contenus légaux et ne jamais garantir des gains. Les fonctionnalités de publication sont activées après acceptation et souscription à une offre active.";
    const contractVersion =
      contractData && typeof contractData === "object" && "version" in contractData && typeof contractData.version === "string"
        ? contractData.version
        : "1.0";
    const now = new Date();
    await tx.subscription.create({
      data: {
        userId: application.userId,
        tenantId: tenant.id,
        planId: plan.id,
        status: "TRIAL",
        currentPeriodStart: now,
        currentPeriodEnd: now,
      },
    });
    await tx.partnershipAgreement.create({
      data: {
        userId: application.userId,
        tenantId: tenant.id,
        version: contractVersion,
        content: contract,
      },
    });
    if (application.user.role === "PLAYER") {
      await tx.user.update({ where: { id: application.userId }, data: { role: "ADMIN" } });
    }
    await tx.partnershipApplication.update({
      where: { id: application.id },
      data: { status: "APPROVED", reviewerId: session.user.id, reviewedAt: now, tenantId: tenant.id },
    });
    await tx.notification.create({
      data: {
        userId: application.userId,
        tenantId: tenant.id,
        type: "PARTNERSHIP",
        title: "Votre demande partenaire est acceptée",
        body: "Lisez et acceptez les conditions pour activer votre espace.",
        href: "/dashboard?tab=partner",
      },
    });
    await tx.auditLog.create({
      data: { actorId: session.user.id, tenantId: tenant.id, action: "PARTNERSHIP_APPROVED", target: application.id },
    });
    return { tenant };
  });

  if (!result) return NextResponse.json({ error: "Cette demande n’est plus en attente." }, { status: 409 });
  return NextResponse.json({ ok: true, tenant: result.tenant ? { id: result.tenant.id, handle: result.tenant.handle } : null });
}
