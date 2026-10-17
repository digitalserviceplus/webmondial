import { hash } from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
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
  const tenant = values.tenantHandle
    ? await prisma.tenant.findFirst({
        where: { handle: values.tenantHandle, status: "ACTIVE" },
        select: { id: true },
      })
    : null;

  if (values.tenantHandle && !tenant) {
    return NextResponse.json({ error: "Cet espace n'est pas disponible." }, { status: 404 });
  }

  const passwordHash = await hash(values.password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: values.name,
          email: values.email?.toLowerCase(),
          phone: values.phone,
          country: values.country,
          passwordHash,
          role: "PLAYER",
        },
        select: { id: true },
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
        { error: "Un compte utilise déjà cet email ou ce numéro. Connectez-vous pour rejoindre cet espace." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
