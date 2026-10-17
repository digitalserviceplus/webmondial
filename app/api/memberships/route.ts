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
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Cet espace n’est pas disponible." }, { status: 404 });
  }

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: { tenantId: tenant.id, userId: session.user.id },
    },
    create: { tenantId: tenant.id, userId: session.user.id },
    update: {},
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
