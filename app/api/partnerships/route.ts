import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const applicationSchema = z.object({
  requestedHandle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  requestedDisplayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(1000).optional(),
});
const reservedHandles = new Set(["admin", "login", "register", "api", "dashboard", "settings", "support", "pricing", "about", "contact", "notifications", "configuration", "connexion", "inscription"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Connectez-vous pour devenir partenaire." }, { status: 401 });
  if (session.user.role !== "PLAYER" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Cette demande est réservée aux joueurs et à l’admin général." }, { status: 403 });
  }
  if (!(await rateLimit(requestKey(request, `partnership:${session.user.id}`), 3, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = applicationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vérifiez votre demande.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (reservedHandles.has(parsed.data.requestedHandle)) return NextResponse.json({ error: "Cet identifiant est réservé." }, { status: 400 });

  try {
    const application = await prisma.partnershipApplication.create({
      data: { ...parsed.data, userId: session.user.id },
      select: { id: true, requestedHandle: true, requestedDisplayName: true, status: true, createdAt: true },
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Cet identifiant est déjà demandé ou utilisé." }, { status: 409 });
    }
    throw error;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role === "SUPER_ADMIN") {
    const applications = await prisma.partnershipApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { id: true, name: true, email: true, phone: true } } },
    });
    return NextResponse.json({ applications });
  }
  const applications = await prisma.partnershipApplication.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, requestedHandle: true, requestedDisplayName: true, status: true, createdAt: true },
  });
  return NextResponse.json({ applications });
}
