import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  reason: z.string().trim().max(2000).optional(),
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.union([z.string().trim().regex(/^\+[1-9]\d{7,14}$/), z.literal("")]).optional(),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(1000).optional(),
  avatarUrl: z.union([z.string().url().max(2048), z.literal("")]).optional(),
});
const reservedHandles = new Set(["admin", "login", "register", "api", "dashboard", "settings", "support", "pricing", "about", "contact", "notifications", "configuration", "connexion", "inscription"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez les informations du partenaire.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (reservedHandles.has(parsed.data.handle)) return NextResponse.json({ error: "Cet identifiant public est réservé." }, { status: 400 });
  if (parsed.data.avatarUrl && new URL(parsed.data.avatarUrl).protocol !== "https:") {
    return NextResponse.json({ error: "L’avatar doit utiliser HTTPS." }, { status: 400 });
  }
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          phone: parsed.data.phone || null,
          avatarUrl: parsed.data.avatarUrl || null,
          role: "ADMIN",
        },
      });
      const createdTenant = await tx.tenant.create({
        data: {
          ownerId: admin.id,
          handle: parsed.data.handle,
          displayName: parsed.data.displayName,
          bio: parsed.data.bio,
          avatarUrl: parsed.data.avatarUrl || null,
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
      const plan = await tx.subscriptionPlan.upsert({
        where: { id: "default-partner-plan" },
        create: { id: "default-partner-plan", name: "Partenaire", monthlyPrice: 200, currency: "XOF", trialDays: 3 },
        update: {},
      });
      const now = new Date();
      await tx.subscription.create({
        data: { userId: admin.id, tenantId: createdTenant.id, planId: plan.id, currentPeriodStart: now, currentPeriodEnd: now },
      });
      await tx.partnershipAgreement.create({
        data: {
          userId: admin.id,
          tenantId: createdTenant.id,
          version: contractVersion,
          content: contract,
        },
      });
      await tx.adminInvitation.create({
        data: {
          userId: admin.id,
          tenantId: createdTenant.id,
          createdById: session.user.id,
          tokenHash,
          expiresAt: new Date(now.getTime() + 48 * 60 * 60_000),
        },
      });
      await tx.auditLog.create({
        data: { actorId: session.user.id, tenantId: createdTenant.id, action: "ADMIN_INVITED", target: admin.id },
      });
      return createdTenant;
    });
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return NextResponse.json({
      tenant: { id: tenant.id, handle: tenant.handle },
      activationUrl: `${origin}/activation?token=${encodeURIComponent(rawToken)}`,
      expiresInHours: 48,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Cet email, téléphone ou identifiant est déjà utilisé." }, { status: 409 });
    }
    throw error;
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const tenants = await prisma.tenant.findMany({
    where: {
      ...(query ? { OR: [{ handle: { contains: query, mode: "insensitive" } }, { displayName: { contains: query, mode: "insensitive" } }] } : {}),
      owner: { role: "ADMIN" },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      handle: true,
      displayName: true,
      status: true,
      suspensionReason: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true, phone: true } },
      _count: { select: { members: true, posts: true, reports: true } },
      subscription: { select: { status: true, currentPeriodEnd: true, paidMonths: true } },
    },
  });
  return NextResponse.json({ tenants });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Modification invalide.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (parsed.data.status === "SUSPENDED" && !parsed.data.reason) {
    return NextResponse.json({ error: "Un motif est obligatoire pour suspendre un partenaire." }, { status: 400 });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
    select: { id: true, handle: true, ownerId: true, owner: { select: { role: true } } },
  });
  if (!tenant || tenant.owner.role !== "ADMIN") return NextResponse.json({ error: "Partenaire introuvable." }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    const updatedTenant = await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: parsed.data.status,
        suspensionReason: parsed.data.status === "SUSPENDED" ? parsed.data.reason : null,
      },
    });
    if (parsed.data.status === "SUSPENDED" || parsed.data.status === "ACTIVE") {
      await tx.notification.create({
        data: {
          userId: tenant.ownerId,
          tenantId: tenant.id,
          type: parsed.data.status === "SUSPENDED" ? "TENANT_SUSPENDED" : "TENANT_REACTIVATED",
          title: parsed.data.status === "SUSPENDED" ? "Votre espace est suspendu" : "Votre espace est réactivé",
          body: parsed.data.status === "SUSPENDED" ? parsed.data.reason! : "Votre espace partenaire est de nouveau actif.",
          href: "/dashboard?tab=support",
        },
      });
    }
    await tx.auditLog.create({
      data: { actorId: session.user.id, tenantId: tenant.id, action: `TENANT_${parsed.data.status}`, target: tenant.id },
    });
    return updatedTenant;
  });
  return NextResponse.json({ ok: true, tenant: updated });
}
