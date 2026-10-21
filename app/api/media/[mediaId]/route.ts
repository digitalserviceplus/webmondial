import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isMediaId, readMediaBytes, readMediaMetadata } from "@/lib/media-storage";
import { isEffectivelyPaid } from "@/lib/publications";

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

  const [posts, results] = await Promise.all([
    prisma.post.findMany({
      where: {
        mediaUrl,
        published: true,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
      },
      select: {
        id: true,
        tenantId: true,
        visibility: true,
        price: true,
        tenant: { select: { ownerId: true } },
      },
    }),
    prisma.couponResult.findMany({
      where: {
        mediaUrl,
        post: { published: true, status: "ACTIVE", tenant: { status: "ACTIVE" } },
      },
      select: {
        post: {
          select: {
            id: true,
            tenantId: true,
            visibility: true,
            price: true,
            tenant: { select: { ownerId: true } },
          },
        },
      },
    }),
  ]);

  const relatedPosts = [...posts, ...results.map(({ post }) => post)];
  let authorized = session?.user.role === "SUPER_ADMIN" || relatedPosts.some((post) =>
    session?.user.role === "ADMIN" &&
    session.user.id === post.tenant.ownerId
  ) || relatedPosts.some((post) =>
    post.visibility === "PUBLIC" ||
    (post.visibility === "PAID" && !isEffectivelyPaid(post.visibility, post.price))
  );

  if (!authorized && session?.user.id) {
    const playerPosts = relatedPosts.filter((post) => post.visibility === "TENANT_PLAYERS");
    const paidPosts = relatedPosts.filter((post) => isEffectivelyPaid(post.visibility, post.price));
    const [memberships, purchases] = await Promise.all([
      playerPosts.length > 0
        ? prisma.tenantMembership.findMany({
            where: {
              userId: session.user.id,
              tenantId: { in: [...new Set(playerPosts.map((post) => post.tenantId))] },
            },
            select: { tenantId: true },
          })
        : Promise.resolve([]),
      paidPosts.length > 0
        ? prisma.publicationPurchase.findMany({
            where: {
              userId: session.user.id,
              postId: { in: paidPosts.map((post) => post.id) },
              payment: { is: { status: "SUCCEEDED" } },
            },
            select: { postId: true },
          })
        : Promise.resolve([]),
    ]);
    const memberTenantIds = new Set(memberships.map(({ tenantId }) => tenantId));
    const purchasedPostIds = new Set(purchases.map(({ postId }) => postId));
    authorized = relatedPosts.some((post) =>
      (post.visibility === "TENANT_PLAYERS" && memberTenantIds.has(post.tenantId)) ||
      (post.visibility === "PAID" && !isEffectivelyPaid(post.visibility, post.price)) ||
      (isEffectivelyPaid(post.visibility, post.price) && purchasedPostIds.has(post.id))
    );
  }

  if (posts.length === 0 && results.length === 0 && session?.user && metadata.tenantId) {
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
