import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, requestKey } from "@/lib/rate-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "PLAYER") {
    return NextResponse.json({ liked: false });
  }
  const { postId } = await params;
  const like = await prisma.postLike.findFirst({
    where: {
      postId,
      userId: session.user.id,
      post: {
        published: true,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
        OR: [
          { visibility: "PUBLIC" },
          { visibility: "TENANT_PLAYERS", tenant: { members: { some: { userId: session.user.id } } } },
        ],
      },
    },
    select: { id: true },
  });
  return NextResponse.json({ liked: Boolean(like) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Connectez-vous pour aimer une publication." }, { status: 401 });
  if (session.user.role !== "PLAYER") return NextResponse.json({ error: "Cette action est réservée aux joueurs." }, { status: 403 });
  if (!(await rateLimit(requestKey(request, `post-like:${session.user.id}`), 60, 60_000))) {
    return NextResponse.json({ error: "Trop d’actions. Réessayez plus tard." }, { status: 429 });
  }
  const { postId } = await params;
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      published: true,
      status: "ACTIVE",
      tenant: { status: "ACTIVE" },
      OR: [
        { visibility: "PUBLIC" },
        { visibility: "TENANT_PLAYERS", tenant: { members: { some: { userId: session.user.id } } } },
      ],
    },
    select: { id: true, tenantId: true },
  });
  if (!post) return NextResponse.json({ error: "Publication introuvable." }, { status: 404 });

  await prisma.postLike.upsert({
    where: { postId_userId: { postId, userId: session.user.id } },
    create: { postId, userId: session.user.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "PLAYER") return NextResponse.json({ error: "Cette action est réservée aux joueurs." }, { status: 403 });
  const { postId } = await params;
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      tenant: { status: "ACTIVE" },
      published: true,
      status: "ACTIVE",
      OR: [
        { visibility: "PUBLIC" },
        { visibility: "TENANT_PLAYERS", tenant: { members: { some: { userId: session.user.id } } } },
      ],
    },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "Publication introuvable." }, { status: 404 });
  await prisma.postLike.deleteMany({ where: { postId, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
