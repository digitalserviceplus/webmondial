import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const joinSchema = z.object({
  tenantHandle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Connectez-vous avant de rejoindre un espace." }, { status: 401 });
  }
  if (session.user.role !== "PLAYER") {
    return NextResponse.json({ error: "Seuls les comptes joueurs peuvent rejoindre un espace." }, { status: 403 });
  }

  const payload: unknown = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "L’identifiant de l’espace est invalide." }, { status: 400 });
  }

  const tenant = await prisma.tenant.findFirst({
    where: { handle: parsed.data.tenantHandle, status: "ACTIVE" },
    select: { id: true, ownerId: true, displayName: true, handle: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Cet espace n’est pas disponible." }, { status: 404 });
  }

  const created = await prisma.tenantMembership.createMany({
    data: { tenantId: tenant.id, userId: session.user.id },
    skipDuplicates: true,
  });
  if (created.count > 0) {
    const globalAdmins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", id: { not: tenant.ownerId } },
      select: { id: true },
    });
    await prisma.notification.createMany({
      data: [
        {
          userId: tenant.ownerId,
          tenantId: tenant.id,
          type: "NEW_PLAYER",
          title: "Nouveau membre",
          body: `Un joueur a rejoint votre espace ${tenant.displayName}.`,
          href: "/dashboard?tab=overview",
        },
        ...globalAdmins.map(({ id }) => ({
          userId: id,
          tenantId: tenant.id,
          type: "NEW_PLAYER" as const,
          title: "Nouveau membre",
          body: `Un joueur a rejoint l’espace ${tenant.displayName}.`,
          href: "/dashboard?tab=overview",
        })),
      ],
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
