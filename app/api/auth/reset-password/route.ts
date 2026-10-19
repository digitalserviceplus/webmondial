import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { getAppUrl, sendPasswordChangedEmail } from "@/lib/email";
import { passwordResetSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "reset-password"), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Demandez un nouveau lien plus tard." }, { status: 429 });
  }
  const parsed = passwordResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Le lien est invalide, les mots de passe ne correspondent pas ou le mot de passe ne respecte pas les critères." }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { email: true } } },
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

  let notificationSent = Boolean(resetToken.user.email);
  if (resetToken.user.email) {
    try {
      const signInUrl = new URL("/connexion", getAppUrl(request)).toString();
      await sendPasswordChangedEmail(resetToken.user.email, signInUrl);
    } catch {
      notificationSent = false;
      console.error("Échec d’envoi de l’email de confirmation du changement de mot de passe.");
    }
  }
  return NextResponse.json({ ok: true, notificationSent });
}
