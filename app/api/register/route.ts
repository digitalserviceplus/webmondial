import { createEmailVerificationCode, EMAIL_VERIFICATION_LIFETIME_MS, hashEmailVerificationCode, hashRateLimitIdentifier } from "@/lib/email-verification";
import { hash } from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { getAppUrl, sendVerificationEmail } from "@/lib/email";
import { registrationSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "register"), 8, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives d’inscription. Réessayez plus tard." }, { status: 429 });
  }
  const payload: unknown = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Vérifiez les informations saisies.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const values = parsed.data;
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Le service d’authentification n’est pas configuré." }, { status: 503 });
  }
  if (!(await rateLimit(`verification-email:${hashRateLimitIdentifier(values.email)}`, 3, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives pour cette adresse. Réessayez plus tard." }, { status: 429 });
  }
  const tenant = values.tenantHandle
    ? await prisma.tenant.findFirst({
        where: { handle: values.tenantHandle, status: "ACTIVE" },
        select: { id: true },
      })
    : null;

  if (values.tenantHandle && !tenant) {
    return NextResponse.json({ error: "Cet espace n'est pas disponible." }, { status: 404 });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: values.email },
    select: { id: true },
  });
  if (existingUser) {
    return NextResponse.json(
      { error: "Cette adresse email est déjà utilisée. Connectez-vous pour rejoindre cet espace." },
      { status: 409 },
    );
  }

  const code = createEmailVerificationCode();
  const codeHash = hashEmailVerificationCode(code, process.env.AUTH_SECRET);
  const passwordHash = await hash(values.password, 12);
  let userId = "";

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: values.name,
          email: values.email,
          country: values.country,
          passwordHash,
          role: "PLAYER",
        },
        select: { id: true },
      });
      userId = user.id;
      await tx.emailVerificationCode.create({
        data: {
          userId: user.id,
          codeHash,
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_LIFETIME_MS),
        },
      });

      if (tenant) {
        await tx.tenantMembership.create({
          data: { userId: user.id, tenantId: tenant.id },
        });
      }
      if (values.language) {
        await tx.userSettings.create({
          data: { userId: user.id, language: values.language },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Cette adresse email est déjà utilisée. Connectez-vous pour rejoindre cet espace." },
        { status: 409 },
      );
    }
    throw error;
  }

  let emailSent = true;
  try {
    const verificationUrl = new URL("/verification-email", getAppUrl(request)).toString();
    await sendVerificationEmail(values.email, code, verificationUrl);
  } catch {
    emailSent = false;
    await prisma.emailVerificationCode.deleteMany({ where: { userId, codeHash } });
    console.error("Échec d’envoi de l’email de vérification. Vérifiez la configuration SMTP.");
  }

  return NextResponse.json({ ok: true, emailSent }, { status: 201 });
}
