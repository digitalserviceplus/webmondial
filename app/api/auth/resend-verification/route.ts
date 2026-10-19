import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { getAppUrl, isEmailDeliveryConfigured, sendVerificationEmail } from "@/lib/email";
import {
  createEmailVerificationCode,
  EMAIL_VERIFICATION_LIFETIME_MS,
  EMAIL_VERIFICATION_RESEND_DELAY_MS,
  hashEmailVerificationCode,
  hashRateLimitIdentifier,
} from "@/lib/email-verification";

const requestSchema = z.object({ email: z.string().trim().email().max(320).toLowerCase() });
const genericMessage = "Si cette adresse correspond à un compte non vérifié, un nouveau code sera envoyé.";

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "resend-verification"), 8, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Saisissez une adresse email valide." }, { status: 400 });
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json({ error: "Configurez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD et SMTP_FROM." }, { status: 503 });
  }
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Le service d’authentification n’est pas configuré." }, { status: 503 });
  }
  let verificationUrl: string;
  try {
    verificationUrl = new URL("/verification-email", getAppUrl(request)).toString();
  } catch {
    return NextResponse.json({ error: "Configurez APP_URL avec l’origine du site." }, { status: 503 });
  }
  const email = parsed.data.email;
  if (!(await rateLimit(`verification-email:${hashRateLimitIdentifier(email)}`, 3, 60 * 60_000))) {
    return NextResponse.json({ message: genericMessage });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user?.email || user.emailVerifiedAt) return NextResponse.json({ message: genericMessage });

  const previousCode = await prisma.emailVerificationCode.findUnique({
    where: { userId: user.id },
    select: { id: true, createdAt: true, expiresAt: true },
  });
  const now = new Date();
  if (previousCode && previousCode.expiresAt > now &&
    now.getTime() - previousCode.createdAt.getTime() < EMAIL_VERIFICATION_RESEND_DELAY_MS) {
    return NextResponse.json({ message: genericMessage });
  }

  const code = createEmailVerificationCode();
  const codeHash = hashEmailVerificationCode(code, process.env.AUTH_SECRET);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS);
  const record = await prisma.emailVerificationCode.upsert({
    where: { userId: user.id },
    create: { userId: user.id, codeHash, expiresAt },
    update: { codeHash, expiresAt, attempts: 0, createdAt: now },
    select: { id: true },
  });

  try {
    await sendVerificationEmail(user.email, code, verificationUrl);
  } catch {
    await prisma.emailVerificationCode.deleteMany({ where: { id: record.id, codeHash } });
    console.error("Échec d’envoi du code de vérification. Vérifiez la configuration SMTP.");
  }
  return NextResponse.json({ message: genericMessage });
}
