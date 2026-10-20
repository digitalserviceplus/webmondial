import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const supportSchema = z.object({
  supportEmail: z.string().optional().default(""),
  supportPhone: z.string().optional().default(""),
  supportWhatsApp: z.string().optional().default(""),
  supportTelegram: z.string().optional().default(""),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "support" },
    select: { value: true },
  });
  const parsed = supportSchema.safeParse(setting?.value ?? {});
  if (!parsed.success) {
    console.error("Les coordonnées d’assistance configurées sont invalides.", parsed.error);
    return NextResponse.json({ error: "Impossible de lire les coordonnées d’assistance." }, { status: 500 });
  }

  return NextResponse.json({ support: parsed.data });
}
