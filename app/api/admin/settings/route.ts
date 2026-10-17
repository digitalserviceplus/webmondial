import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const settingsSchema = z.object({
  monthlyPrice: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  trialDays: z.number().int().min(0).max(30).optional(),
  supportEmail: z.union([z.string().email(), z.literal("")]).optional(),
  supportPhone: z.string().max(30).optional(),
  supportWhatsApp: z.string().max(80).optional(),
  supportTelegram: z.string().max(120).optional(),
  partnerContract: z.string().trim().min(20).max(20000).optional(),
});

async function superAdmin() {
  const session = await auth();
  if (!session?.user) return { session: null, error: "unauthenticated" as const };
  if (session.user.role !== "SUPER_ADMIN") return { session, error: "forbidden" as const };
  return { session, error: null };
}

export async function GET() {
  const access = await superAdmin();
  if (access.error) return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: access.error === "unauthenticated" ? 401 : 403 });
  const [plan, settings] = await Promise.all([
    prisma.subscriptionPlan.findFirst({ where: { enabled: true }, orderBy: { createdAt: "asc" } }),
    prisma.systemSetting.findMany({
      where: { key: { in: ["support", "partner-contract"] } },
      select: { key: true, value: true },
    }),
  ]);
  return NextResponse.json({ plan, settings: Object.fromEntries(settings.map((item) => [item.key, item.value])) });
}

export async function PATCH(request: Request) {
  const access = await superAdmin();
  if (access.error) return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: access.error === "unauthenticated" ? 401 : 403 });
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez les paramètres.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const { monthlyPrice, currency, trialDays, supportEmail, supportPhone, supportWhatsApp, supportTelegram, partnerContract } = parsed.data;
  await prisma.$transaction(async (tx) => {
    if (monthlyPrice !== undefined || currency !== undefined || trialDays !== undefined) {
      const existing = await tx.subscriptionPlan.findFirst({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
      const data = {
        monthlyPrice: monthlyPrice ?? existing?.monthlyPrice ?? 200,
        currency: currency ?? existing?.currency ?? "XOF",
        trialDays: trialDays ?? existing?.trialDays ?? 3,
      };
      if (existing) await tx.subscriptionPlan.update({ where: { id: existing.id }, data });
      else await tx.subscriptionPlan.create({ data: { id: "default-partner-plan", name: "Partenaire", ...data } });
    }
    if (supportEmail !== undefined || supportPhone !== undefined || supportWhatsApp !== undefined || supportTelegram !== undefined) {
      const current = await tx.systemSetting.findUnique({ where: { key: "support" }, select: { value: true } });
      const previous = current?.value && typeof current.value === "object" ? current.value : {};
      await tx.systemSetting.upsert({
        where: { key: "support" },
        create: {
          key: "support",
          value: {
            supportEmail: supportEmail ?? "",
            supportPhone: supportPhone ?? "",
            supportWhatsApp: supportWhatsApp ?? "",
            supportTelegram: supportTelegram ?? "",
          },
        },
        update: {
          value: {
            ...previous,
            ...(supportEmail !== undefined ? { supportEmail } : {}),
            ...(supportPhone !== undefined ? { supportPhone } : {}),
            ...(supportWhatsApp !== undefined ? { supportWhatsApp } : {}),
            ...(supportTelegram !== undefined ? { supportTelegram } : {}),
          },
        },
      });
    }
    if (partnerContract !== undefined) {
      const version = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
      await tx.systemSetting.upsert({
        where: { key: "partner-contract" },
        create: { key: "partner-contract", value: { version, content: partnerContract } },
        update: { value: { version, content: partnerContract } },
      });
    }
    await tx.auditLog.create({
      data: { actorId: access.session!.user.id, action: "GLOBAL_SETTINGS_UPDATED", metadata: { keys: Object.keys(parsed.data) } },
    });
  });
  return NextResponse.json({ ok: true });
}
