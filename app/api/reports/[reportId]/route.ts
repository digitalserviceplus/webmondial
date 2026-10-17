import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const reviewSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
  resolution: z.string().trim().max(2000).optional(),
  suspendTenant: z.boolean().optional(),
  suspensionReason: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision de modération invalide." }, { status: 400 });
  if (parsed.data.suspendTenant && !parsed.data.suspensionReason) {
    return NextResponse.json({ error: "Un motif est obligatoire pour suspendre un espace." }, { status: 400 });
  }
  const { reportId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({
      where: { id: reportId },
      include: { tenant: { select: { id: true, ownerId: true, handle: true } } },
    });
    if (!report) return null;
    if (parsed.data.suspendTenant) {
      await tx.tenant.update({
        where: { id: report.tenant.id },
        data: { status: "SUSPENDED", suspensionReason: parsed.data.suspensionReason },
      });
      await tx.notification.create({
        data: {
          userId: report.tenant.ownerId,
          tenantId: report.tenant.id,
          type: "TENANT_SUSPENDED",
          title: "Votre espace est suspendu",
          body: parsed.data.suspensionReason!,
          href: "/dashboard?tab=support",
        },
      });
    }
    const updated = await tx.report.update({
      where: { id: report.id },
      data: {
        status: parsed.data.status,
        resolution: parsed.data.resolution,
        reviewerId: session.user.id,
        reviewedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        tenantId: report.tenant.id,
        action: parsed.data.suspendTenant ? "REPORT_REVIEW_AND_TENANT_SUSPENSION" : "REPORT_REVIEWED",
        target: report.id,
      },
    });
    return updated;
  });
  if (!result) return NextResponse.json({ error: "Signalement introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true, report: result });
}
