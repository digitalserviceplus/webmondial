import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { hasBeenOnPlatformForMoreThanThreeMonths } from "@/lib/report-eligibility";

const reportSchema = z.object({
  tenantHandle: z.string().trim().toLowerCase().min(1).max(40),
  reason: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Connectez-vous pour envoyer un signalement." }, { status: 401 });
  if (session.user.role !== "PLAYER") return NextResponse.json({ error: "Cette action est réservée aux joueurs." }, { status: 403 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez le signalement.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const player = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { createdAt: true },
  });
  if (!player || !hasBeenOnPlatformForMoreThanThreeMonths(player.createdAt)) {
    return NextResponse.json({ error: "Le signalement d’un administrateur est disponible après plus de trois mois sur la plateforme." }, { status: 403 });
  }
  if (!(await rateLimit(requestKey(request, `report:${session.user.id}`), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de signalements. Réessayez plus tard." }, { status: 429 });
  }
  const tenant = await prisma.tenant.findFirst({
    where: {
      handle: parsed.data.tenantHandle,
      status: { not: "ARCHIVED" },
      owner: { role: "ADMIN" },
      members: { some: { userId: session.user.id } },
    },
    select: { id: true, handle: true, ownerId: true },
  });
  if (!tenant) return NextResponse.json({ error: "Cet espace ne peut pas être signalé." }, { status: 404 });

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        tenantId: tenant.id,
        authorId: session.user.id,
        reason: parsed.data.reason,
        description: parsed.data.description,
      },
    });
    const superAdmins = await tx.user.findMany({
      where: { role: "SUPER_ADMIN" },
      select: { id: true },
    });
    await tx.notification.createMany({
      data: superAdmins.map(({ id }) => ({
        userId: id,
        tenantId: tenant.id,
        type: "NEW_REPORT",
        title: "Nouveau signalement",
        body: `Un joueur a signalé l’espace @${tenant.handle}.`,
        href: "/dashboard?tab=reports",
      })),
    });
    await tx.notification.create({
      data: {
        userId: tenant.ownerId,
        tenantId: tenant.id,
        type: "NEW_REPORT",
        title: "Un signalement a été transmis",
        body: "L’administration a été informée d’un signalement concernant votre espace.",
        href: "/dashboard?tab=support",
      },
    });
    await tx.auditLog.create({
      data: { actorId: session.user.id, tenantId: tenant.id, action: "TENANT_REPORTED", target: created.id },
    });
    return created;
  });
  return NextResponse.json({ ok: true, reportId: report.id }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role === "SUPER_ADMIN") {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        tenant: { select: { handle: true, displayName: true, status: true } },
        author: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json({ reports });
  }
  const reports = await prisma.report.findMany({
    where: { authorId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { tenant: { select: { handle: true, displayName: true } } },
  });
  return NextResponse.json({ reports });
}
