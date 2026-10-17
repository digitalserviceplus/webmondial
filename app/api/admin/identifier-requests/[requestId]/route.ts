import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const reviewSchema = z.object({ decision: z.enum(["RESOLVED", "DISMISSED"]) });
const reservedHandles = new Set(["admin", "login", "register", "api", "dashboard", "settings", "support", "pricing", "about", "contact", "notifications", "configuration", "connexion", "inscription"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision invalide." }, { status: 400 });
  const { requestId } = await params;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const change = await tx.identifierChangeRequest.findUnique({
        where: { id: requestId },
        include: { tenant: { select: { id: true, handle: true, ownerId: true } } },
      });
      if (!change || change.status !== "OPEN") return null;
      if (parsed.data.decision === "RESOLVED") {
        if (reservedHandles.has(change.requestedHandle)) throw new Error("HANDLE_RESERVED");
        const existing = await tx.tenant.findUnique({ where: { handle: change.requestedHandle }, select: { id: true } });
        if (existing && existing.id !== change.tenant.id) throw new Error("HANDLE_TAKEN");
        await tx.tenantAlias.upsert({
          where: { handle: change.oldHandle },
          create: { tenantId: change.tenant.id, handle: change.oldHandle },
          update: { tenantId: change.tenant.id },
        });
        await tx.tenant.update({ where: { id: change.tenant.id }, data: { handle: change.requestedHandle } });
        await tx.notification.create({
          data: {
            userId: change.tenant.ownerId,
            tenantId: change.tenant.id,
            type: "SYSTEM",
            title: "Identifiant public modifié",
            body: `Votre nouvel identifiant public est @${change.requestedHandle}. L’ancien lien redirige vers votre profil.`,
            href: `/${change.requestedHandle}`,
          },
        });
      }
      const result = await tx.identifierChangeRequest.update({
        where: { id: change.id },
        data: { status: parsed.data.decision, reviewerId: session.user.id, reviewedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { actorId: session.user.id, tenantId: change.tenant.id, action: "IDENTIFIER_CHANGE_REVIEWED", target: change.id },
      });
      return result;
    });
    if (!updated) return NextResponse.json({ error: "Cette demande n’est plus ouverte." }, { status: 409 });
    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "HANDLE_RESERVED") {
      return NextResponse.json({ error: "Cet identifiant est réservé." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "HANDLE_TAKEN") {
      return NextResponse.json({ error: "Cet identifiant a été utilisé entre-temps." }, { status: 409 });
    }
    throw error;
  }
}
