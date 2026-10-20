import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isMediaId, readMediaMetadata } from "@/lib/media-storage";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { annualSubscriptionCutoff, canPublishContent, canPublishPaidContent } from "@/lib/subscriptions";

const categories = ["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE", "GENERAL"] as const;
const visibilityOptions = ["PUBLIC", "TENANT_PLAYERS", "PRIVATE", "PAID"] as const;
const postSchema = z.object({
  category: z.enum(categories),
  title: z.string().trim().max(180).optional(),
  content: z.string().trim().min(1).max(20_000),
  sport: z.string().trim().max(50).optional(),
  visibility: z.enum(visibilityOptions).default("TENANT_PLAYERS"),
  price: z.number().int().positive().max(100_000_000).optional(),
  mediaUrl: z.string().trim().max(2048).optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
});

function preview(content: string) {
  return content.length > 220 ? `${content.slice(0, 220).trimEnd()}…` : content;
}

function mediaTypeFromUrl(value: string): "IMAGE" | "VIDEO" | undefined {
  let pathname: string;
  try {
    pathname = new URL(value).pathname.toLowerCase();
  } catch {
    return undefined;
  }
  if (/\.(jpe?g|png|gif|webp)$/.test(pathname)) return "IMAGE";
  if (/\.(mp4|webm)$/.test(pathname)) return "VIDEO";
  return undefined;
}

export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const handle = url.searchParams.get("tenant")?.trim().toLowerCase();
  const category = url.searchParams.get("category");
  const requestedVisibility = url.searchParams.get("visibility");
  const cursor = url.searchParams.get("cursor");
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 30);
  if (
    !handle ||
    (category && !categories.includes(category as (typeof categories)[number])) ||
    (requestedVisibility && requestedVisibility !== "PAID")
  ) {
    return NextResponse.json({ error: "Un espace et une catégorie valides sont requis." }, { status: 400 });
  }
  if (!(await rateLimit(requestKey(request, "posts-read"), 90, 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes. Réessayez dans une minute." }, { status: 429 });
  }
  const tenant = await prisma.tenant.findFirst({
    where: { handle, status: "ACTIVE" },
    select: {
      id: true,
      ownerId: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      owner: { select: { avatarUrl: true } },
    },
  });
  if (!tenant) return NextResponse.json({ error: "Espace introuvable." }, { status: 404 });

  const isOwnerOrSuperAdmin =
    session?.user.role === "SUPER_ADMIN" ||
    (session?.user.role === "ADMIN" && session.user.id === tenant.ownerId);
  const isMember =
    isOwnerOrSuperAdmin ||
    Boolean(
      session?.user.id &&
        (await prisma.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: tenant.id, userId: session.user.id } },
          select: { id: true },
        })),
    );

  const where: Prisma.PostWhereInput = {
    tenantId: tenant.id,
    published: true,
    status: "ACTIVE" as const,
    ...(category ? { category: category as (typeof categories)[number] } : {}),
    ...(requestedVisibility === "PAID"
      ? { visibility: "PAID" as const }
      : isOwnerOrSuperAdmin
      ? {}
      : isMember
        ? { visibility: { in: ["PUBLIC", "TENANT_PLAYERS", "PAID"] } }
        : { visibility: { in: ["PUBLIC", "PAID"] } }),
  };
  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      category: true,
      title: true,
      content: true,
      sport: true,
      visibility: true,
      price: true,
      currency: true,
      mediaUrl: true,
      mediaType: true,
      createdAt: true,
      authorId: true,
      _count: { select: { likes: true, ...(isOwnerOrSuperAdmin ? { views: true } : {}) } },
      likes: session?.user.id
        ? { where: { userId: session.user.id }, select: { id: true }, take: 1 }
        : false,
      purchases: session?.user.id
        ? { where: { userId: session.user.id }, select: { id: true }, take: 1 }
        : false,
    },
  });
  const hasMore = posts.length > pageSize;
  const page = posts.slice(0, pageSize);
  const responsePosts = await Promise.all(
    page.map(async (post) => {
      const canView =
        isOwnerOrSuperAdmin ||
        post.visibility === "PUBLIC" ||
        (isMember && post.visibility === "TENANT_PLAYERS") ||
        (post.visibility === "PAID" && Boolean(post.purchases?.length));
      const isOwner = post.authorId === session?.user.id;
      const locked = post.visibility === "PAID" && !canView && !isOwner;
      return {
        ...post,
        content: locked ? preview(post.content) : post.content,
        mediaUrl: locked ? null : post.mediaUrl,
        mediaType: locked ? null : post.mediaType,
        locked,
        liked: Boolean(post.likes?.length),
        purchased: Boolean(post.purchases?.length),
        authorId: undefined,
        likes: undefined,
        purchases: undefined,
      };
    }),
  );

  if (isMember) {
    if (!session?.user.id) throw new Error("Authenticated tenant member is missing an account ID.");
    await prisma.publicationView.createMany({
      data: page.map((post) => ({ postId: post.id, userId: session.user.id })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    posts: responsePosts,
    tenant: {
      handle: tenant.handle,
      displayName: tenant.displayName,
      avatarUrl: tenant.avatarUrl ?? tenant.owner.avatarUrl,
    },
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  }
  if (!(await rateLimit(requestKey(request, `post-create:${session.user.id}`), 12, 60_000))) {
    return NextResponse.json({ error: "Limite de publications atteinte. Réessayez plus tard." }, { status: 429 });
  }

  const payload: unknown = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Vérifiez les informations de la publication.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const tenant = await prisma.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true, handle: true, displayName: true, status: true },
  });
  if (!tenant) return NextResponse.json({ error: "Aucun espace partenaire n’est associé à votre compte." }, { status: 404 });
  if (tenant.status !== "ACTIVE") return NextResponse.json({ error: "Votre espace est suspendu ou inactif." }, { status: 403 });

  const subscription = session.user.role !== "SUPER_ADMIN"
    ? await prisma.subscription.findUnique({
        where: { tenantId: tenant.id },
        select: { status: true, currentPeriodEnd: true, trialEndsAt: true },
      })
    : null;
  if (session.user.role !== "SUPER_ADMIN" && !canPublishContent(subscription)) {
    return NextResponse.json(
      { error: "Votre période d’essai ou votre abonnement a expiré. Souscrivez ou renouvelez pour publier." },
      { status: 403 },
    );
  }

  const annualPayment = parsed.data.visibility === "PAID" && session.user.role !== "SUPER_ADMIN"
    ? await prisma.payment.findFirst({
        where: {
          tenantId: tenant.id,
          type: "PARTNER_SUBSCRIPTION",
          status: "SUCCEEDED",
          months: { gte: 12 },
          processedAt: { gte: annualSubscriptionCutoff() },
        },
        orderBy: { processedAt: "desc" },
        select: { processedAt: true },
      })
    : null;
  if (
    parsed.data.visibility === "PAID" &&
    session.user.role !== "SUPER_ADMIN" &&
    !canPublishPaidContent(subscription, annualPayment?.processedAt ?? null)
  ) {
    return NextResponse.json({ error: "Les contenus payants sont réservés aux partenaires ayant un abonnement annuel actif." }, { status: 403 });
  }
  if (parsed.data.visibility === "PAID" && !parsed.data.price) {
    return NextResponse.json({ error: "Indiquez un prix pour ce contenu payant." }, { status: 400 });
  }
  let mediaType = parsed.data.mediaType;
  if (parsed.data.mediaUrl) {
    const localMediaId = /^\/api\/media\/([^/]+)$/.exec(parsed.data.mediaUrl)?.[1];
    if (localMediaId && isMediaId(localMediaId)) {
      const metadata = await readMediaMetadata(localMediaId);
      if (
        !metadata ||
        metadata.purpose !== "post"
      ) {
        return NextResponse.json({ error: "Le média est introuvable ou ne peut pas être utilisé dans une publication." }, { status: 400 });
      }
      mediaType = metadata.mediaType;
    } else {
      let protocol: string;
      try {
        protocol = new URL(parsed.data.mediaUrl).protocol;
      } catch {
        return NextResponse.json({ error: "Le média doit utiliser une adresse HTTPS ou un fichier téléversé." }, { status: 400 });
      }
      if (protocol !== "https:") {
        return NextResponse.json({ error: "Le média doit utiliser une adresse HTTPS." }, { status: 400 });
      }
      mediaType = mediaTypeFromUrl(parsed.data.mediaUrl) ?? mediaType;
    }
    if (!mediaType) return NextResponse.json({ error: "Le type du média n’a pas pu être détecté." }, { status: 400 });
  }

  let post: { id: string; visibility: string; category: string };
  try {
    post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          tenantId: tenant.id,
          authorId: session.user.id,
          category: parsed.data.category,
          title: parsed.data.title,
          content: parsed.data.content,
          sport: parsed.data.sport,
          visibility: parsed.data.visibility,
          price: parsed.data.visibility === "PAID" ? parsed.data.price : null,
          mediaUrl: parsed.data.mediaUrl,
          mediaType: parsed.data.mediaUrl ? mediaType : null,
          published: true,
        },
        select: { id: true, visibility: true, category: true },
      });
      const members = await tx.tenantMembership.findMany({
        where: { tenantId: tenant.id },
        select: { userId: true, user: { select: { settings: { select: { language: true } } } } },
      });
      if (members.length > 0) {
        await tx.notification.createMany({
          data: members.map(({ userId, user }) => ({
            userId,
            tenantId: tenant.id,
            type: created.category === "PREMIUM" || created.visibility === "PAID" ? "NEW_PREMIUM_PUBLICATION" : "NEW_PUBLICATION",
            title: user.settings?.language === "en"
              ? `${tenant.displayName} published`
              : user.settings?.language === "es"
                ? `${tenant.displayName} ha publicado`
                : `${tenant.displayName} a publié`,
            body: user.settings?.language === "en"
              ? "A new post is available in your community."
              : user.settings?.language === "es"
                ? "Hay una nueva publicación en tu comunidad."
                : "Une nouvelle publication est disponible dans votre espace.",
            href: `/${tenant.handle}`,
          })),
        });
      }
      await tx.auditLog.create({
        data: { actorId: session.user.id, tenantId: tenant.id, action: "POST_CREATED", target: created.id },
      });
      return created;
    });
  } catch (error) {
    console.error("Publication creation transaction failed.", error);
    const schemaNotReady = error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022");
    return NextResponse.json(
      {
        error: schemaNotReady
          ? "La base de données n’est pas à jour. Les migrations doivent être appliquées."
          : "Impossible d’enregistrer la publication. Réessayez et contactez l’administration si le problème persiste.",
      },
      { status: schemaNotReady ? 503 : 500 },
    );
  }

  return NextResponse.json({ ok: true, post }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
  }
  const payload: unknown = await request.json().catch(() => null);
  const parsed = z.object({ id: z.string().min(1), ...postSchema.shape }).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Vérifiez les informations de la publication.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const post = await prisma.post.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      tenantId: true,
      authorId: true,
      createdAt: true,
      tenant: { select: { ownerId: true, status: true } },
    },
  });
  if (!post) return NextResponse.json({ error: "Publication introuvable." }, { status: 404 });
  if (session.user.role !== "SUPER_ADMIN" && post.tenant.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Accès interdit." }, { status: 403 });
  }
  if (post.tenant.status !== "ACTIVE") return NextResponse.json({ error: "Cet espace n’est pas actif." }, { status: 403 });
  if (Date.now() - post.createdAt.getTime() > 10 * 60_000) {
    return NextResponse.json({ error: "La modification n’est possible que pendant les 10 minutes suivant la publication." }, { status: 403 });
  }
  const subscription = session.user.role !== "SUPER_ADMIN"
    ? await prisma.subscription.findUnique({
      where: { tenantId: post.tenantId },
      select: { status: true, currentPeriodEnd: true, trialEndsAt: true },
    })
    : null;
  if (session.user.role !== "SUPER_ADMIN" && !canPublishContent(subscription)) {
    return NextResponse.json(
      { error: "Votre période d’essai ou votre abonnement a expiré. Souscrivez ou renouvelez pour publier." },
      { status: 403 },
    );
  }
  if (parsed.data.visibility === "PAID" && session.user.role !== "SUPER_ADMIN") {
    const annualPayment = await prisma.payment.findFirst({
        where: {
          tenantId: post.tenantId,
          type: "PARTNER_SUBSCRIPTION",
          status: "SUCCEEDED",
          months: { gte: 12 },
          processedAt: { gte: annualSubscriptionCutoff() },
        },
        orderBy: { processedAt: "desc" },
        select: { processedAt: true },
      });
    if (!canPublishPaidContent(subscription, annualPayment?.processedAt ?? null)) {
      return NextResponse.json({ error: "Un abonnement annuel actif et payé en une fois est nécessaire." }, { status: 403 });
    }
  }
  if (parsed.data.visibility === "PAID" && !parsed.data.price) {
    return NextResponse.json({ error: "Indiquez un prix pour ce contenu payant." }, { status: 400 });
  }
  let mediaType = parsed.data.mediaType;
  if (parsed.data.mediaUrl) {
    const localMediaId = /^\/api\/media\/([^/]+)$/.exec(parsed.data.mediaUrl)?.[1];
    if (localMediaId && isMediaId(localMediaId)) {
      const metadata = await readMediaMetadata(localMediaId);
      if (!metadata || metadata.purpose !== "post") {
        return NextResponse.json({ error: "Le média est introuvable ou ne peut pas être utilisé dans une publication." }, { status: 400 });
      }
      mediaType = metadata.mediaType;
    } else {
      try {
        if (new URL(parsed.data.mediaUrl).protocol !== "https:") throw new Error("URL");
      } catch {
        return NextResponse.json({ error: "Le média doit utiliser une adresse HTTPS ou un téléversement valide." }, { status: 400 });
      }
      mediaType = mediaTypeFromUrl(parsed.data.mediaUrl) ?? mediaType;
    }
    if (!mediaType) return NextResponse.json({ error: "Le type du média n’a pas pu être détecté." }, { status: 400 });
  }
  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      category: parsed.data.category,
      title: parsed.data.title,
      content: parsed.data.content,
      sport: parsed.data.sport,
      visibility: parsed.data.visibility,
      price: parsed.data.visibility === "PAID" ? parsed.data.price : null,
      mediaUrl: parsed.data.mediaUrl || null,
      mediaType: parsed.data.mediaUrl ? mediaType : null,
    },
    select: { id: true },
  });
  await prisma.auditLog.create({
    data: { actorId: session.user.id, tenantId: post.tenantId, action: "POST_UPDATED", target: post.id },
  });
  return NextResponse.json({ ok: true, post: updated });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  const postId = new URL(request.url).searchParams.get("id");
  if (!postId) return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, tenantId: true, authorId: true, tenant: { select: { ownerId: true } } },
  });
  if (!post) return NextResponse.json({ error: "Publication introuvable." }, { status: 404 });
  if (session.user.role !== "SUPER_ADMIN" && post.tenant.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Accès interdit." }, { status: 403 });
  }
  await prisma.$transaction([
    prisma.post.update({ where: { id: post.id }, data: { status: "DELETED", published: false } }),
    prisma.auditLog.create({
      data: { actorId: session.user.id, tenantId: post.tenantId, action: "POST_DELETED", target: post.id },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
