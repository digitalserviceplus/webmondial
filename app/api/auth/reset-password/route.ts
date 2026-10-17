import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { strongPasswordSchema } from "@/lib/validation";

const resetSchema = z.object({
  token: z.string().min(32).max(128),
  password: strongPasswordSchema,
});

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "reset-password"), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Demandez un nouveau lien plus tard." }, { status: 429 });
  }
  const parsed = resetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Le lien est invalide ou le mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
    return NextResponse.json({ error: "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau." }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const changed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: resetToken.userId }, data: { passwordHash } });
    await tx.passwordResetToken.updateMany({
      where: { userId: resetToken.userId, id: { not: resetToken.id }, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });
  if (!changed) return NextResponse.json({ error: "Ce lien a déjà été utilisé. Demandez-en un nouveau." }, { status: 409 });

  return NextResponse.json({ ok: true });
}
