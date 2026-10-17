import { timingSafeEqual } from "node:crypto";
import { hash } from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { initialAdminSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { ensureGeneralAdminTenant } from "@/lib/admin-general-tenant";

function matchesSetupToken(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  if (!(await rateLimit(requestKey(request, "initial-setup"), 5, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, { status: 429 });
  }
  const expectedToken = process.env.INITIAL_SETUP_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "La configuration initiale est désactivée. Définissez INITIAL_SETUP_TOKEN côté serveur." },
      { status: 503 },
    );
  }

  const payload: unknown = await request.json().catch(() => null);
  const parsed = initialAdminSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Vérifiez les informations saisies.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (!matchesSetupToken(parsed.data.setupToken, expectedToken)) {
    return NextResponse.json({ error: "Le code de configuration est invalide." }, { status: 403 });
  }

  const passwordHash = await hash(parsed.data.password, 12);

  try {
    const admin = await prisma.$transaction(async (tx) => {
      const existingAdmin = await tx.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        select: { id: true },
      });
      if (existingAdmin) throw new Error("INITIAL_ADMIN_EXISTS");

      await tx.setupState.create({ data: { key: "initial-super-admin" } });
      const admin = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          phone: parsed.data.phone,
          passwordHash,
          role: "SUPER_ADMIN",
        },
        select: { id: true },
      });
      if (parsed.data.language) {
        await tx.userSettings.create({ data: { userId: admin.id, language: parsed.data.language } });
      }
      return admin;
    });
    await ensureGeneralAdminTenant(admin.id);
  } catch (error) {
    if (error instanceof Error && error.message === "INITIAL_ADMIN_EXISTS") {
      return NextResponse.json({ error: "L’admin général est déjà configuré." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "La configuration initiale est déjà terminée ou cet email est déjà utilisé." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
