import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewTenantPost } from "@/lib/tenant-access";
import { isMediaId, readMediaBytes, readMediaMetadata } from "@/lib/media-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await params;
  if (!isMediaId(mediaId)) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });

  let metadata;
  try {
    metadata = await readMediaMetadata(mediaId);
  } catch (error) {
    console.error("Métadonnées de média invalides.", error);
    return NextResponse.json({ error: "Impossible de lire ce média." }, { status: 500 });
  }
  if (!metadata) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });

  const session = await auth();
  const mediaUrl = `/api/media/${mediaId}`;
  if (metadata.purpose === "avatar") {
    const user = await prisma.user.findUnique({
      where: { id: metadata.ownerId },
      select: {
        avatarUrl: true,
        role: true,
        ownedTenants: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
      },
    });
    const authorized =
      session?.user.id === metadata.ownerId ||
      session?.user.role === "SUPER_ADMIN" ||
      (user?.role === "ADMIN" && user.avatarUrl === mediaUrl && user.ownedTenants.length > 0) ||
      (user?.role === "SUPER_ADMIN" && user.avatarUrl === mediaUrl);
    if (!authorized) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });

    let bytes: Uint8Array | null;
    try {
      bytes = await readMediaBytes(mediaId, metadata.contentType);
    } catch (error) {
      console.error("Échec de la lecture d’une photo de profil.", error);
      return NextResponse.json({ error: "Impossible de lire cette photo." }, { status: 500 });
    }
    if (!bytes) return NextResponse.json({ error: "Fichier média introuvable." }, { status: 404 });
    return mediaResponse(bytes, metadata.contentType);
  }

  if (!metadata.tenantId) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });
  const posts = await prisma.post.findMany({
    where: {
      tenantId: metadata.tenantId,
      mediaUrl,
      published: true,
      status: "ACTIVE",
    },
    select: { id: true, tenantId: true, visibility: true },
  });
  const results = await prisma.couponResult.findMany({
    where: {
      tenantId: metadata.tenantId,
      mediaUrl,
      post: { published: true, status: "ACTIVE", tenant: { status: "ACTIVE" } },
    },
    select: { post: { select: { id: true, tenantId: true, visibility: true } } },
  });

  let authorized = false;
  const relatedPosts = [...posts, ...results.map(({ post }) => post)];
  for (const post of relatedPosts) {
    if (authorized) break;
    if (await canViewTenantPost({
      userId: session?.user.id,
      role: session?.user.role,
      tenantId: post.tenantId,
      postId: post.id,
      visibility: post.visibility,
    })) {
      authorized = true;
      break;
    }
  }

  if (posts.length === 0 && results.length === 0 && session?.user) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: metadata.tenantId },
      select: { ownerId: true, status: true },
    });
    authorized =
      tenant?.status === "ACTIVE" &&
      (session.user.id === metadata.ownerId ||
        session.user.role === "SUPER_ADMIN" ||
        (session.user.role === "ADMIN" && session.user.id === tenant.ownerId));
  }
  if (!authorized) return NextResponse.json({ error: "Média introuvable." }, { status: 404 });

  let bytes: Uint8Array | null;
  try {
    bytes = await readMediaBytes(mediaId, metadata.contentType);
  } catch (error) {
    console.error("Échec de la lecture d’un média téléversé.", error);
    return NextResponse.json({ error: "Impossible de lire ce média." }, { status: 500 });
  }
  if (!bytes) return NextResponse.json({ error: "Fichier média introuvable." }, { status: 404 });

  return mediaResponse(bytes, metadata.contentType);
}

function mediaResponse(bytes: Uint8Array, contentType: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
