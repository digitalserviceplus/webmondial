import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailVerificationSchema } from "@/lib/validation";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  hashRateLimitIdentifier,
  matchesEmailVerificationCode,
} from "@/lib/email-verification";

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "verify-email"), 20, 15 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = emailVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez l’adresse email et le code à 8 chiffres." }, { status: 400 });
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "Le service d’authentification n’est pas configuré." }, { status: 503 });
  const { email, code } = parsed.data;
  if (!(await rateLimit(`verify-email-address:${hashRateLimitIdentifier(email)}`, 10, 15 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Demandez un nouveau code." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user) return NextResponse.json({ error: "Le code est invalide ou expiré." }, { status: 400 });
  if (user.emailVerifiedAt) return NextResponse.json({ error: "Cette adresse email est déjà vérifiée." }, { status: 409 });

  const verification = await prisma.emailVerificationCode.findUnique({
    where: { userId: user.id },
    select: { id: true, codeHash: true, attempts: true, expiresAt: true },
  });
  const now = new Date();
  if (!verification || verification.expiresAt <= now) {
    if (verification) await prisma.emailVerificationCode.deleteMany({ where: { id: verification.id } });
    return NextResponse.json({ error: "Le code a expiré. Demandez-en un nouveau." }, { status: 410 });
  }
  if (verification.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "La limite de tentatives est atteinte. Demandez un nouveau code." }, { status: 429 });
  }

  const validCode = matchesEmailVerificationCode(code, verification.codeHash, secret);
  if (!validCode) {
    const attempt = await prisma.emailVerificationCode.updateMany({
      where: { id: verification.id, attempts: { lt: EMAIL_VERIFICATION_MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) return NextResponse.json({ error: "La limite de tentatives est atteinte. Demandez un nouveau code." }, { status: 429 });
    return NextResponse.json({ error: "Le code de vérification est incorrect." }, { status: 400 });
  }

  const verified = await prisma.$transaction(async (tx) => {
    const consumed = await tx.emailVerificationCode.deleteMany({
      where: {
        id: verification.id,
        codeHash: verification.codeHash,
        attempts: { lt: EMAIL_VERIFICATION_MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
    });
    if (consumed.count !== 1) return false;
    const updated = await tx.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    return updated.count === 1;
  });
  if (!verified) return NextResponse.json({ error: "Le code a déjà été utilisé. Connectez-vous." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
