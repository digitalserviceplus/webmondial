import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const requestSchema = z.object({ email: z.string().trim().email().max(320) });
const TOKEN_LIFETIME_MS = 30 * 60_000;

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "forgot-password"), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }
  if (process.env.NODE_ENV === "production" && (
    !process.env.EMAIL_SERVER_URL ||
    !process.env.EMAIL_FROM ||
    !(process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL)
  )) {
    return NextResponse.json({ error: "Le service de récupération par email n’est pas configuré." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Saisissez une adresse email valide." }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
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

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? new URL(request.url).origin;
  const resetUrl = new URL("/reinitialiser-mot-de-passe", origin);
  resetUrl.searchParams.set("token", token);
  if (process.env.NODE_ENV === "development") {
    return NextResponse.json({
      message: "Lien de récupération local généré. Il expire dans 30 minutes.",
      resetUrl: resetUrl.toString(),
    });
  }

  try {
    await sendPasswordResetEmail(user.email, resetUrl.toString());
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash, usedAt: null } });
    console.error("Échec d’envoi de l’email de récupération.", error);
    return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
  }

  return NextResponse.json({ message: "Si cette adresse correspond à un compte, un lien de récupération sera envoyé." });
}
