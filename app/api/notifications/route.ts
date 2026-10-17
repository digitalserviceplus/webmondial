import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const tenant = session.user.role === "ADMIN"
    ? await prisma.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true } })
    : null;
  const notifications = await prisma.notification.findMany({
    where: {
      userId: session.user.id,
      ...(session.user.role === "ADMIN" ? { tenantId: tenant?.id ?? "__no_partner_space__" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, type: true, title: true, body: true, href: true, readAt: true, createdAt: true },
  });
  return NextResponse.json({ notifications });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Notification invalide." }, { status: 400 });
  const tenant = session.user.role === "ADMIN"
    ? await prisma.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true } })
    : null;
  const notificationScope = {
    userId: session.user.id,
    ...(session.user.role === "ADMIN" ? { tenantId: tenant?.id ?? "__no_partner_space__" } : {}),
  };
  const updated = await prisma.notification.updateMany({
    where: { id: parsed.data.id, ...notificationScope, readAt: null },
    data: { readAt: new Date() },
  });
  if (!updated.count) {
    const owned = await prisma.notification.findFirst({
      where: { id: parsed.data.id, ...notificationScope },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Notification introuvable." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
