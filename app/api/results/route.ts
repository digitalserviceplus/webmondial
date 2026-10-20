import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isMediaId, isMediaStored, readMediaMetadata, resolveMediaType } from "@/lib/media-storage";
import { canPublishContent } from "@/lib/subscriptions";

const resultSchema = z.object({
  postId: z.string().min(1),
  title: z.string().trim().max(180).optional(),
  content: z.string().trim().min(1).max(20_000),
  mediaUrl: z.string().trim().max(2048).optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
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

  const results = await prisma.couponResult.findMany({
    where: {
      tenantId: tenant.id,
      post: { published: true, status: "ACTIVE", tenant: { status: "ACTIVE" } },
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
    select: { id: true },
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
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "Choisissez un coupon publié aujourd’hui dans votre espace." }, { status: 404 });

  if (parsed.data.mediaUrl) {
    const localMediaId = /^\/api\/media\/([^/]+)$/.exec(parsed.data.mediaUrl)?.[1];
    if (localMediaId && isMediaId(localMediaId)) {
      const metadata = await readMediaMetadata(localMediaId);
      if (!metadata || metadata.purpose !== "post" || metadata.ownerId !== session.user.id || metadata.tenantId !== tenant.id || metadata.mediaType !== parsed.data.mediaType) {
        return NextResponse.json({ error: "Le média ne correspond pas à cet espace ou à ce type." }, { status: 403 });
      }
      if (!(await isMediaStored(localMediaId, metadata.contentType))) {
        return NextResponse.json({ error: "Le téléversement de l’image ou de la vidéo n’est pas terminé. Réessayez avant d’enregistrer." }, { status: 400 });
      }
    } else {
      try {
        if (new URL(parsed.data.mediaUrl).protocol !== "https:") throw new Error("URL");
      } catch {
        return NextResponse.json({ error: "Le média doit utiliser une adresse HTTPS ou provenir d’un téléversement valide." }, { status: 400 });
      }
    }
    if (!parsed.data.mediaType) return NextResponse.json({ error: "Précisez le type du média." }, { status: 400 });
  }

  const result = await prisma.couponResult.upsert({
    where: { postId: post.id },
    create: {
      tenantId: tenant.id,
      postId: post.id,
      title: parsed.data.title,
      content: parsed.data.content,
      mediaUrl: parsed.data.mediaUrl,
      mediaType: parsed.data.mediaUrl ? parsed.data.mediaType : null,
    },
    update: {
      title: parsed.data.title,
      content: parsed.data.content,
      mediaUrl: parsed.data.mediaUrl,
      mediaType: parsed.data.mediaUrl ? parsed.data.mediaType : null,
    },
  });
  return NextResponse.json({ ok: true, result });
}
