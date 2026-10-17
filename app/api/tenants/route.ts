import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2) return NextResponse.json([]);
  if (query.length > 80) return NextResponse.json({ error: "Recherche trop longue." }, { status: 400 });
  if (!(await rateLimit(requestKey(request, "tenant-search"), 30, 60_000))) {
    return NextResponse.json({ error: "Trop de recherches. Réessayez dans une minute." }, { status: 429 });
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { handle: { contains: query.toLowerCase(), mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      handle: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
    },
    orderBy: { displayName: "asc" },
    take: 8,
  });

  return NextResponse.json(tenants);
}
