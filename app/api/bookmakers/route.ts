import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookmakerSchema } from "@/lib/validation";

function secureUrl(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
}

async function accessibleTenant(userId: string, role: string) {
  if (role === "ADMIN" || role === "SUPER_ADMIN") {
    return prisma.tenant.findFirst({
      where: { ownerId: userId, status: "ACTIVE" },
      select: { id: true },
    });
  }
  if (role === "PLAYER") {
    return prisma.tenantMembership.findFirst({
      where: { userId, tenant: { status: "ACTIVE" } },
      select: { tenantId: true },
      orderBy: { createdAt: "desc" },
    }).then((membership) => membership ? { id: membership.tenantId } : null);
  }
  return null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const tenant = await accessibleTenant(session.user.id, session.user.role);
  if (!tenant) return NextResponse.json({ bookmakers: [] });
  const bookmakers = await prisma.bookmaker.findMany({
    where: { tenantId: tenant.id, ...(session.user.role === "PLAYER" ? { active: true } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ bookmakers });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  const parsed = bookmakerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez les informations du bookmaker.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (!secureUrl(parsed.data.signupUrl) || (parsed.data.videoUrl && !secureUrl(parsed.data.videoUrl)) || (parsed.data.logoUrl && !secureUrl(parsed.data.logoUrl))) {
    return NextResponse.json({ error: "Les liens doivent utiliser HTTPS." }, { status: 400 });
  }
  if (!parsed.data.videoUrl) {
    return NextResponse.json({ error: "Ajoutez le lien de la vidéo d’inscription pour créer le bookmaker." }, { status: 400 });
  }

  const tenant = await prisma.tenant.findFirst({
    where: { ownerId: session.user.id, status: "ACTIVE" },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: "Aucun espace partenaire actif." }, { status: 403 });
  const { id, videoUrl, logoUrl, ...data } = parsed.data;
  if (id) {
    const existing = await prisma.bookmaker.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Bookmaker introuvable." }, { status: 404 });
    const bookmaker = await prisma.bookmaker.update({
      where: { id },
      data: { ...data, videoUrl: videoUrl || null, logoUrl: logoUrl || null },
    });
    return NextResponse.json({ bookmaker });
  }
  const bookmaker = await prisma.bookmaker.create({
    data: { ...data, videoUrl: videoUrl || null, logoUrl: logoUrl || null, tenantId: tenant.id },
  });
  return NextResponse.json({ bookmaker }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  const tenant = await prisma.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "Espace introuvable." }, { status: 404 });
  const deleted = await prisma.bookmaker.deleteMany({ where: { id, tenantId: tenant.id } });
  if (!deleted.count) return NextResponse.json({ error: "Bookmaker introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
