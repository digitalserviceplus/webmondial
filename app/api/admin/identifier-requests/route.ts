import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Accès réservé à l’admin général." }, { status: 403 });
  const requests = await prisma.identifierChangeRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { tenant: { select: { handle: true, displayName: true } } },
  });
  return NextResponse.json({ requests });
}
