import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const applicationSchema = z.object({
  requestedHandle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  requestedDisplayName: z.string().trim().min(2).max(80),
});
const reservedHandles = new Set(["admin", "login", "register", "api", "dashboard", "settings", "support", "pricing", "about", "contact", "notifications", "configuration", "connexion", "inscription"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Connectez-vous pour devenir partenaire." }, { status: 401 });
  if (session.user.role !== "PLAYER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Cette demande est réservée aux joueurs et à l’admin général." }, { status: 403 });
  }
  if (!(await rateLimit(requestKey(request, `partnership:${session.user.id}`), 3, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = applicationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez votre demande.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (reservedHandles.has(parsed.data.requestedHandle)) return NextResponse.json({ error: "Cet identifiant est réservé." }, { status: 400 });

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, role: true },
      });
      if (!user || (user.role !== "PLAYER" && user.role !== "SUPER_ADMIN")) {
        throw new Error("Only player accounts and the general admin can become partners.");
      }
      const now = new Date();
      const application = await tx.partnershipApplication.create({
        data: {
          ...parsed.data,
          userId: user.id,
          status: "APPROVED",
          reviewedAt: now,
        },
      });
      const tenant = await tx.tenant.create({
        data: {
          ownerId: user.id,
          handle: application.requestedHandle,
          displayName: application.requestedDisplayName,
          status: "PENDING",
        },
      });
      const configuredContract = await tx.systemSetting.findUnique({
        where: { key: "partner-contract" },
        select: { value: true },
      });
      const contractData = configuredContract?.value;
      const contract = contractData && typeof contractData === "object"
        && "content" in contractData && typeof contractData.content === "string"
        ? contractData.content
        : "En utilisant cet espace, le partenaire s’engage à respecter les règles de la plateforme, publier des contenus légaux et ne jamais garantir des gains.";
      const contractVersion = contractData && typeof contractData === "object"
        && "version" in contractData && typeof contractData.version === "string"
        ? contractData.version
        : "1.0";
      const applicantDetails = [
        "",
        "",
        "Informations du demandeur",
        `Nom complet : ${user.name}`,
        `Nom de profil : ${application.requestedDisplayName} (@${application.requestedHandle})`,
        `Date de la demande : ${application.createdAt.toISOString().slice(0, 10)}`,
      ].join("\n");
      const plan = await tx.subscriptionPlan.findFirst({
        where: { enabled: true },
        orderBy: { createdAt: "asc" },
      }) ?? await tx.subscriptionPlan.create({
        data: { id: "default-partner-plan", name: "Partenaire", monthlyPrice: 200, currency: "XOF", trialDays: 7 },
      });
      await tx.subscription.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          planId: plan.id,
          status: "TRIAL",
          currentPeriodStart: now,
          currentPeriodEnd: now,
        },
      });
      await tx.partnershipAgreement.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          version: contractVersion,
          content: `${contract.trimEnd()}${applicantDetails}`,
        },
      });
      await tx.partnershipApplication.update({
        where: { id: application.id },
        data: { tenantId: tenant.id },
      });
      if (user.role === "PLAYER") {
        await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
      }
      await tx.notification.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          type: "PARTNERSHIP",
          title: "Votre espace partenaire est prêt pour signature",
          body: "Votre demande est approuvée automatiquement. Consultez et signez le contrat pour activer votre espace.",
          href: "/dashboard?tab=agreement",
        },
      });
      const generalAdmins = await tx.user.findMany({
        where: { role: "SUPER_ADMIN" },
        select: { id: true },
      });
      await tx.notification.createMany({
        data: generalAdmins.map(({ id }) => ({
          userId: id,
          tenantId: tenant.id,
          type: "PARTNERSHIP" as const,
          title: "Nouvel espace partenaire à signer",
          body: `@${tenant.handle} a validé son inscription et attend la signature du contrat.`,
          href: "/dashboard?tab=applications",
        })),
      });
      await tx.auditLog.create({
        data: { actorId: user.id, tenantId: tenant.id, action: "PARTNERSHIP_AUTO_APPROVED", target: application.id },
      });
      return tenant;
    });
    return NextResponse.json({ ok: true, tenant: { id: tenant.id, handle: tenant.handle } }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Cet identifiant est déjà demandé ou utilisé." }, { status: 409 });
    }
    throw error;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role === "SUPER_ADMIN") {
    const applications = await prisma.partnershipApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { id: true, name: true, email: true, phone: true } } },
    });
    return NextResponse.json({ applications });
  }
  const applications = await prisma.partnershipApplication.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, requestedHandle: true, requestedDisplayName: true, status: true, createdAt: true },
  });
  return NextResponse.json({ applications });
}
