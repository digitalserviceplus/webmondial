import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAppUrl, isEmailDeliveryConfigured, sendPasswordResetEmail } from "@/lib/email";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { hashRateLimitIdentifier } from "@/lib/email-verification";

const requestSchema = z.object({ email: z.string().trim().email().max(320) });
const TOKEN_LIFETIME_MS = 30 * 60_000;

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "forgot-password"), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }
  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json({ error: "Configurez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM et APP_URL pour activer la récupération." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Saisissez une adresse email valide." }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
  if (!(await rateLimit(`forgot-password-email:${hashRateLimitIdentifier(email)}`, 3, 60 * 60_000))) {
    return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
  }
  let appUrl: URL;
  try {
    appUrl = getAppUrl(request);
  } catch {
    return NextResponse.json({ error: "Le lien de récupération n’est pas configuré. Vérifiez APP_URL." }, { status: 503 });
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user?.email) {
    return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
  ]);

  const resetUrl = new URL("/reinitialiser-mot-de-passe", appUrl);
  resetUrl.searchParams.set("token", token);

  try {
    await sendPasswordResetEmail(user.email, resetUrl.toString());
  } catch {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash, usedAt: null } });
    console.error("Échec d’envoi de l’email de récupération. Vérifiez la configuration SMTP.");
    return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
  }

  return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
}
