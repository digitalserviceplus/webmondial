import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { strongPasswordSchema } from "@/lib/validation";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const activationSchema = z.object({
  token: z.string().min(32).max(256),
  password: strongPasswordSchema,
});

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "activation"), 8, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = activationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Le mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invitation = await prisma.adminInvitation.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, acceptedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Ce lien d’activation est invalide ou expiré." }, { status: 410 });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const accepted = await prisma.$transaction(async (tx) => {
    const updated = await tx.adminInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (updated.count !== 1) return false;
    await tx.user.update({
      where: { id: invitation.userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    });
    return true;
  });
  if (!accepted) return NextResponse.json({ error: "Ce lien a déjà été utilisé." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
