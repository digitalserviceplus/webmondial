import { hash } from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { strongPasswordSchema } from "@/lib/validation";
import { getAppUrl, isEmailDeliveryConfigured, sendPasswordChangedEmail, sendVerificationEmail } from "@/lib/email";
import { hashRateLimitIdentifier, createEmailVerificationCode, EMAIL_VERIFICATION_LIFETIME_MS, hashEmailVerificationCode } from "@/lib/email-verification";
import { rateLimit } from "@/lib/rate-limit";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
  phone: z.union([z.string().trim().regex(/^\+[1-9]\d{7,14}$/), z.literal("")]).optional(),
  country: z.string().trim().max(80).optional(),
  displayName: z.string().trim().min(2).max(80).optional(),
  paymentLink: z.union([
    z.string().url().max(2048).refine((value) => value.startsWith("https://"), "Utilisez un lien HTTPS."),
    z.literal(""),
  ]).optional(),
  paymentPhone: z.union([z.string().trim().regex(/^\+[1-9]\d{7,14}$/), z.literal("")]).optional(),
  paymentInstructions: z.string().trim().max(2000).optional(),
  avatarUrl: z.union([
    z.string().url().max(2048),
    z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
    z.literal(""),
  ]).optional(),
  bio: z.string().trim().max(1000).optional(),
  language: z.enum(["fr", "en", "es"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  notifications: z.preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean().optional(),
  ),
});
const handleRequestSchema = z.object({
  requestedHandle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  reason: z.string().trim().min(10).max(1000),
});
const reservedHandles = new Set(["admin", "login", "register", "api", "dashboard", "settings", "support", "pricing", "about", "contact", "notifications", "configuration", "connexion", "inscription"]);

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      phone: true,
      country: true,
      avatarUrl: true,
      role: true,
      settings: { select: { language: true, theme: true, notifications: true, timezone: true } },
      ownedTenants: {
        select: {
          handle: true,
          displayName: true,
          bio: true,
          status: true,
          ...(session.user.role === "ADMIN"
            ? { paymentLink: true, paymentPhone: true, paymentInstructions: true }
            : {}),
        },
      },
    },
  });
  if (!user) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const payload: unknown = await request.json().catch(() => null);
  const intent = z.object({ intent: z.literal("change-handle") }).safeParse(payload);
  if (intent.success) {
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Cette action est réservée aux partenaires." }, { status: 403 });
    const parsed = handleRequestSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ error: "Vérifiez la demande.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    if (reservedHandles.has(parsed.data.requestedHandle)) return NextResponse.json({ error: "Cet identifiant est réservé." }, { status: 400 });
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true, handle: true } });
    if (!tenant) return NextResponse.json({ error: "Espace introuvable." }, { status: 404 });
    if (tenant.handle === parsed.data.requestedHandle) return NextResponse.json({ error: "Cet identifiant est déjà le vôtre." }, { status: 400 });
    const existing = await prisma.tenant.findUnique({ where: { handle: parsed.data.requestedHandle }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Cet identifiant est déjà utilisé." }, { status: 409 });
    const changeRequest = await prisma.$transaction(async (tx) => {
      const created = await tx.identifierChangeRequest.create({
        data: { tenantId: tenant.id, oldHandle: tenant.handle, ...parsed.data },
        select: { id: true, requestedHandle: true, status: true },
      });
      const generalAdmins = await tx.user.findMany({
        where: { role: "SUPER_ADMIN" },
        select: { id: true, settings: { select: { language: true } } },
      });
      await tx.notification.createMany({
        data: generalAdmins.map((admin) => {
          const english = admin.settings?.language === "en";
          const spanish = admin.settings?.language === "es";
          return {
            userId: admin.id,
            tenantId: tenant.id,
            type: "SYSTEM" as const,
            title: english
              ? "Public handle change request"
              : spanish
                ? "Solicitud de cambio de identificador"
                : "Nouvelle demande de modification d’identifiant",
            body: english
              ? `@${tenant.handle} requests @${parsed.data.requestedHandle}: ${parsed.data.reason}`
              : spanish
                ? `@${tenant.handle} solicita @${parsed.data.requestedHandle}: ${parsed.data.reason}`
                : `@${tenant.handle} demande @${parsed.data.requestedHandle} : ${parsed.data.reason}`,
            href: "/dashboard?tab=identifier-requests",
          };
        }),
      });
      return created;
    });
    return NextResponse.json({ request: changeRequest }, { status: 201 });
  }

  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez les paramètres.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const {
    bio,
    displayName,
    language,
    theme,
    notifications,
    paymentLink,
    paymentPhone,
    paymentInstructions,
    email: requestedEmail,
    ...userData
  } = parsed.data;
  const normalizedEmail = requestedEmail?.trim().toLowerCase();
  const currentUser = requestedEmail !== undefined
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
    : null;
  if (requestedEmail !== undefined && !currentUser) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  if (normalizedEmail === "" && currentUser?.email) {
    return NextResponse.json({ error: "Une adresse email est nécessaire pour se connecter." }, { status: 400 });
  }
  const emailChanged = Boolean(normalizedEmail && normalizedEmail !== currentUser?.email);
  let emailCode: string | undefined;
  let emailCodeHash: string | undefined;
  let verificationUrl: string | undefined;
  if (emailChanged && normalizedEmail) {
    if (!process.env.AUTH_SECRET) {
      return NextResponse.json({ error: "Le service d’authentification n’est pas configuré." }, { status: 503 });
    }
    if (!isEmailDeliveryConfigured()) {
      return NextResponse.json({ error: "Configurez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD et SMTP_FROM avant de changer l’adresse email." }, { status: 503 });
    }
    try {
      verificationUrl = new URL("/verification-email", getAppUrl(request)).toString();
    } catch {
      return NextResponse.json({ error: "Configurez APP_URL avec l’origine du site." }, { status: 503 });
    }
    if (!(await rateLimit(`verification-email:${hashRateLimitIdentifier(normalizedEmail)}`, 3, 60 * 60_000))) {
      return NextResponse.json({ error: "Trop de demandes pour cette adresse. Réessayez plus tard." }, { status: 429 });
    }
    const existingEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingEmail && existingEmail.id !== session.user.id) {
      return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 });
    }
    emailCode = createEmailVerificationCode();
    emailCodeHash = hashEmailVerificationCode(emailCode, process.env.AUTH_SECRET);
  }
  if (
    session.user.role === "SUPER_ADMIN" &&
    (paymentLink !== undefined || paymentPhone !== undefined || paymentInstructions !== undefined)
  ) {
    return NextResponse.json({ error: "Les paiements de l’admin général sont gérés exclusivement par SasPay." }, { status: 403 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (emailChanged || Object.values(userData).some((value) => value !== undefined)) {
        await tx.user.update({
          where: { id: session.user.id },
          data: {
            ...userData,
            email: emailChanged ? normalizedEmail : undefined,
            emailVerifiedAt: emailChanged ? null : undefined,
            phone: userData.phone === "" ? null : userData.phone,
            avatarUrl: userData.avatarUrl === "" ? null : userData.avatarUrl,
          },
        });
      }
      if (emailChanged && emailCodeHash) {
        const now = new Date();
        await tx.emailVerificationCode.upsert({
          where: { userId: session.user.id },
          create: {
            userId: session.user.id,
            codeHash: emailCodeHash,
            expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
          },
          update: {
            codeHash: emailCodeHash,
            attempts: 0,
            expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
            createdAt: now,
          },
        });
        await tx.passwordResetToken.deleteMany({ where: { userId: session.user.id, usedAt: null } });
      }
      if (language || theme || notifications !== undefined) {
        await tx.userSettings.upsert({
          where: { userId: session.user.id },
          create: {
            userId: session.user.id,
            language: language ?? "fr",
            theme: theme ?? "dark",
            notifications: notifications ?? true,
          },
          update: { language, theme, notifications },
        });
      }
      if (bio !== undefined && (session.user.role === "ADMIN" || session.user.role === "SUPER_ADMIN")) {
        await tx.tenant.updateMany({ where: { ownerId: session.user.id }, data: { bio } });
      }
      if (displayName !== undefined && (session.user.role === "ADMIN" || session.user.role === "SUPER_ADMIN")) {
        await tx.tenant.updateMany({ where: { ownerId: session.user.id }, data: { displayName } });
      }
      if (
        (paymentLink !== undefined || paymentPhone !== undefined || paymentInstructions !== undefined) &&
        session.user.role === "ADMIN"
      ) {
        await tx.tenant.updateMany({
          where: { ownerId: session.user.id },
          data: {
            paymentLink: paymentLink === "" ? null : paymentLink,
            paymentPhone: paymentPhone === "" ? null : paymentPhone,
            paymentInstructions,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Cet email ou ce numéro appartient déjà à un autre compte." }, { status: 409 });
    }
    throw error;
  }
  if (emailChanged && normalizedEmail && emailCode && emailCodeHash && verificationUrl) {
    let emailSent = true;
    try {
      await sendVerificationEmail(normalizedEmail, emailCode, verificationUrl);
    } catch {
      emailSent = false;
      await prisma.emailVerificationCode.deleteMany({
        where: { userId: session.user.id, codeHash: emailCodeHash },
      });
      console.error("Échec d’envoi de l’email de vérification après changement d’adresse.");
    }
    return NextResponse.json({ ok: true, emailVerificationRequired: true, emailSent });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: strongPasswordSchema,
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Le nouveau mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true, email: true } });
  if (!user?.passwordHash) return NextResponse.json({ error: "Ce compte ne peut pas changer son mot de passe ici." }, { status: 400 });
  const { compare } = await import("bcryptjs");
  if (!(await compare(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Le mot de passe actuel est incorrect." }, { status: 403 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: await hash(parsed.data.newPassword, 12) },
  });
  let notificationSent = Boolean(user.email);
  if (user.email) {
    try {
      const signInUrl = new URL("/connexion", getAppUrl(request)).toString();
      await sendPasswordChangedEmail(user.email, signInUrl);
    } catch {
      notificationSent = false;
      console.error("Échec d’envoi de l’email de confirmation du changement de mot de passe.");
    }
  }
  return NextResponse.json({ ok: true, notificationSent });
}
