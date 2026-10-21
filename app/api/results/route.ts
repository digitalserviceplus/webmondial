import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isMediaId, readMediaMetadata, resolveMediaType } from "@/lib/media-storage";
import { isEffectivelyPaid } from "@/lib/publications";
import { canPublishContent } from "@/lib/subscriptions";

const resultSchema = z.object({
  postId: z.string().min(1),
  title: z.string().trim().max(180).optional(),
  content: z.string().trim().min(1).max(20_000),
  mediaUrl: z.string().trim().max(2048).optional(),
});

function utcDayBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get("tenant")?.trim().toLowerCase();
  if (!handle) return NextResponse.json({ error: "Un espace est requis." }, { status: 400 });
  const tenant = await prisma.tenant.findFirst({
    where: { handle, status: "ACTIVE" },
    select: { id: true, handle: true, ownerId: true },
  });
  if (!tenant) return NextResponse.json({ error: "Espace introuvable." }, { status: 404 });

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Connectez-vous pour consulter les résultats des coupons." }, { status: 401 });
  }
  const canManage = Boolean(
    session.user.role === "SUPER_ADMIN" ||
      (session.user.role === "ADMIN" && session.user.id === tenant.ownerId),
  );
  if (new URL(request.url).searchParams.get("manage") === "1") {
    if (!canManage) return NextResponse.json({ error: "Accès réservé aux administrateurs de cet espace." }, { status: 403 });
    const { start, end } = utcDayBounds();
    const posts = await prisma.post.findMany({
      where: {
        tenantId: tenant.id,
        published: true,
        status: "ACTIVE",
        publishedAt: { gte: start, lt: end },
        category: { in: ["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE"] },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        title: true,
        category: true,
        publishedAt: true,
        result: { select: { id: true, title: true, content: true, mediaUrl: true, mediaType: true } },
      },
    });
    const resolvedPosts = await Promise.all(posts.map(async (post) => ({
      ...post,
      result: post.result
        ? { ...post.result, mediaType: await resolveMediaType(post.result.mediaUrl, post.result.mediaType) }
        : null,
    })));
    return NextResponse.json({ posts: resolvedPosts });
  }

  const isMember = session.user.role === "PLAYER"
    ? Boolean(await prisma.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: tenant.id, userId: session.user.id } },
        select: { id: true },
      }))
    : false;
  const results = await prisma.couponResult.findMany({
    where: {
      tenantId: tenant.id,
      post: {
        published: true,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
        ...(canManage ? {} : {
          OR: [
            { visibility: "PUBLIC" as const },
            ...(isMember ? [{ visibility: "TENANT_PLAYERS" as const }] : []),
            {
              visibility: "PAID" as const,
              OR: [
                { price: null },
                { price: { lte: 0 } },
                { purchases: { some: { userId: session.user.id, payment: { is: { status: "SUCCEEDED" } } } } },
              ],
            },
          ],
        }),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      content: true,
      mediaUrl: true,
      mediaType: true,
      createdAt: true,
      post: { select: { id: true, title: true, category: true, publishedAt: true } },
    },
  });
  const resolvedResults = await Promise.all(results.map(async (result) => ({
    ...result,
    mediaType: await resolveMediaType(result.mediaUrl, result.mediaType),
  })));
  return NextResponse.json({ results: resolvedResults });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });
  }
  const parsed = resultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Vérifiez les informations du résultat.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const tenant = await prisma.tenant.findFirst({
    where: { ownerId: session.user.id, status: "ACTIVE" },
    select: { id: true, handle: true },
  });
  if (!tenant) return NextResponse.json({ error: "Aucun espace partenaire actif." }, { status: 403 });
  if (session.user.role !== "SUPER_ADMIN") {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: tenant.id },
      select: { status: true, currentPeriodEnd: true, trialEndsAt: true },
    });
    if (!canPublishContent(subscription)) {
      return NextResponse.json(
        { error: "Votre période d’essai ou votre abonnement a expiré. Renouvelez pour publier les résultats." },
        { status: 403 },
      );
    }
  }
  const { start, end } = utcDayBounds();
  const post = await prisma.post.findFirst({
    where: {
      id: parsed.data.postId,
      tenantId: tenant.id,
      published: true,
      status: "ACTIVE",
      publishedAt: { gte: start, lt: end },
      category: { in: ["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE"] },
    },
    select: { id: true, visibility: true, price: true },
  });
  if (!post) return NextResponse.json({ error: "Choisissez un coupon publié aujourd’hui dans votre espace." }, { status: 404 });

  const mediaUrl = parsed.data.mediaUrl || null;
  let mediaType: "IMAGE" | "VIDEO" | null = null;
  if (mediaUrl) {
    const localMediaId = /^\/api\/media\/([^/]+)$/.exec(mediaUrl)?.[1];
    if (!localMediaId || !isMediaId(localMediaId)) {
      return NextResponse.json({ error: "Sélectionnez une image ou une vidéo à téléverser depuis votre appareil." }, { status: 400 });
    }
    const metadata = await readMediaMetadata(localMediaId);
    if (!metadata || metadata.purpose !== "post" || metadata.ownerId !== session.user.id || metadata.tenantId !== tenant.id) {
      return NextResponse.json({ error: "Le média ne correspond pas à cet espace." }, { status: 403 });
    }
    mediaType = metadata.mediaType;
  }

  const { result } = await prisma.$transaction(async (tx) => {
    const existing = await tx.couponResult.findUnique({
      where: { postId: post.id },
      select: { id: true },
    });
    const result = await tx.couponResult.upsert({
      where: { postId: post.id },
      create: {
        tenantId: tenant.id,
        postId: post.id,
        title: parsed.data.title,
        content: parsed.data.content,
        mediaUrl,
        mediaType,
      },
      update: {
        title: parsed.data.title,
        content: parsed.data.content,
        mediaUrl,
        mediaType,
      },
    });
    if (existing) return { result };

    const recipientIds = new Set<string>();
    if (isEffectivelyPaid(post.visibility, post.price)) {
      const purchases = await tx.publicationPurchase.findMany({
        where: { postId: post.id, payment: { is: { status: "SUCCEEDED" } } },
        select: { userId: true },
      });
      purchases.forEach(({ userId }) => recipientIds.add(userId));
    } else if (post.visibility !== "PRIVATE") {
      const members = await tx.tenantMembership.findMany({
        where: { tenantId: tenant.id },
        select: { userId: true },
      });
      members.forEach(({ userId }) => recipientIds.add(userId));
    }

    const globalAdmins = await tx.user.findMany({
      where: { role: "SUPER_ADMIN", id: { not: session.user.id } },
      select: { id: true },
    });
    globalAdmins.forEach(({ id }) => recipientIds.add(id));
    recipientIds.delete(session.user.id);
    if (recipientIds.size > 0) {
      await tx.notification.createMany({
        data: [...recipientIds].map((userId) => ({
          userId,
          tenantId: tenant.id,
          type: "NEW_PUBLICATION",
          title: "Nouveau résultat",
          body: `Un résultat a été publié pour un coupon dans l’espace @${tenant.handle}.`,
          href: `/dashboard?tab=results&tenant=${encodeURIComponent(tenant.handle)}`,
        })),
      });
    }
    return { result };
  });
  return NextResponse.json({ ok: true, result });
}
