import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider, SasPayPaymentProvider } from "@/lib/payments/provider";
import { calculateSubscription } from "@/lib/subscriptions";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { countryCodeFromValue } from "@/lib/countries";
import { isEffectivelyPaid } from "@/lib/publications";

const paymentSchema = z.union([
  z.object({
    type: z.literal("subscription"),
    plan: z.literal("monthly"),
    months: z.number().int().min(1).max(11),
  }),
  z.object({ type: z.literal("subscription"), plan: z.literal("annual") }),
  z.object({ type: z.literal("publication"), postId: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (!(await rateLimit(requestKey(request, `payment:${session.user.id}`), 8, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives de paiement. Réessayez plus tard." }, { status: 429 });
  }
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande de paiement invalide." }, { status: 400 });

  let paymentInput: {
    amount: number;
    currency: string;
    type: "PARTNER_SUBSCRIPTION" | "PAID_PUBLICATION";
    tenantId: string | null;
    subscriptionId: string | null;
    months?: number;
    postId?: string;
    title: string;
    returnTo: string;
  };

  if (parsed.data.type === "subscription") {
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Seuls les partenaires peuvent souscrire." }, { status: 403 });
    const tenant = await prisma.tenant.findFirst({
      where: { ownerId: session.user.id },
      select: { id: true, status: true, subscription: { select: { id: true } } },
    });
    if (!tenant) return NextResponse.json({ error: "Espace partenaire introuvable." }, { status: 404 });
    if (tenant.status === "SUSPENDED" || tenant.status === "ARCHIVED") {
      return NextResponse.json({ error: "Les paiements sont indisponibles pour cet espace." }, { status: 403 });
    }
    const plan = await prisma.subscriptionPlan.findFirst({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
    if (!plan) return NextResponse.json({ error: "Aucune offre d’abonnement n’est configurée." }, { status: 503 });
    const months = parsed.data.plan === "annual" ? 12 : parsed.data.months;
    const calculated = calculateSubscription(plan.monthlyPrice, months, plan.currency);
    paymentInput = {
      amount: calculated.amount,
      currency: calculated.currency,
      type: "PARTNER_SUBSCRIPTION",
      tenantId: tenant.id,
      subscriptionId: tenant.subscription?.id ?? null,
      months,
      title: parsed.data.plan === "annual" ? "Abonnement annuel" : `Abonnement mensuel · ${months} mois`,
      returnTo: "/dashboard?tab=subscription",
    };
  } else {
    if (session.user.role !== "PLAYER") return NextResponse.json({ error: "Seuls les joueurs peuvent acheter un contenu." }, { status: 403 });
    const post = await prisma.post.findFirst({
      where: {
        id: parsed.data.postId,
        visibility: "PAID",
        status: "ACTIVE",
        published: true,
        tenant: { status: "ACTIVE" },
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        price: true,
        currency: true,
        tenant: {
          select: {
            handle: true,
            paymentLink: true,
            paymentPhone: true,
            paymentInstructions: true,
            ownerId: true,
            displayName: true,
            owner: { select: { role: true } },
          },
        },
      },
    });
    if (!post) return NextResponse.json({ error: "Contenu payant introuvable." }, { status: 404 });
    if (await prisma.publicationPurchase.findFirst({
      where: {
        postId: post.id,
        userId: session.user.id,
        payment: { is: { status: "SUCCEEDED" } },
      },
      select: { id: true },
    })) {
      return NextResponse.json({ error: "Ce contenu est déjà débloqué." }, { status: 409 });
    }
    if (!isEffectivelyPaid("PAID", post.price)) {
      return NextResponse.json({ error: "Cette publication est gratuite et ne nécessite aucun paiement." }, { status: 409 });
    }
    paymentInput = {
      amount: Number(post.price),
      currency: post.currency,
      type: "PAID_PUBLICATION",
      tenantId: post.tenantId,
      subscriptionId: null,
      postId: post.id,
      title: post.title ?? "Contenu premium",
      returnTo: `/${post.tenant.handle}`,
    };
    if (post.tenant.owner.role !== "SUPER_ADMIN") {
      if (!post.tenant.paymentLink && !post.tenant.paymentPhone && !post.tenant.paymentInstructions) {
        return NextResponse.json({ error: "Le partenaire n’a pas encore configuré ses moyens de paiement." }, { status: 409 });
      }
      const pendingPayment = await prisma.payment.findFirst({
        where: {
          userId: session.user.id,
          tenantId: post.tenantId,
          type: "PAID_PUBLICATION",
          provider: "manual",
          status: "PENDING",
          amount: paymentInput.amount,
          currency: paymentInput.currency,
          metadata: { path: ["postId"], equals: post.id },
        },
        select: { id: true, externalReference: true, amount: true, currency: true, status: true },
      });
      const payment = pendingPayment ?? await prisma.payment.create({
        data: {
          userId: session.user.id,
          tenantId: post.tenantId,
          type: "PAID_PUBLICATION",
          provider: "manual",
          externalReference: `wm_${randomUUID()}`,
          amount: paymentInput.amount,
          currency: paymentInput.currency,
          metadata: { postId: post.id, paymentMode: "MANUAL" },
        },
        select: { id: true, externalReference: true, amount: true, currency: true, status: true },
      });
      if (!pendingPayment) {
        const globalAdmins = await prisma.user.findMany({
          where: { role: "SUPER_ADMIN", id: { not: post.tenant.ownerId } },
          select: { id: true },
        });
        await prisma.notification.createMany({
          data: [
            {
              userId: post.tenant.ownerId,
              tenantId: post.tenantId,
              type: "SYSTEM",
              title: "Paiement en attente",
              body: `Un joueur demande l’accès à « ${post.title ?? "Publication premium"} ». Confirmez le paiement après réception.`,
              href: "/dashboard?tab=posts",
            },
            ...globalAdmins.map(({ id }) => ({
              userId: id,
              tenantId: post.tenantId,
              type: "SYSTEM" as const,
              title: "Paiement en attente",
              body: `Un paiement manuel est en attente dans l’espace ${post.tenant.displayName}.`,
              href: "/dashboard?tab=overview",
            })),
          ],
        });
      }
      return NextResponse.json({
        manualPayment: true,
        payment,
        checkoutUrl: post.tenant.paymentLink,
        paymentPhone: post.tenant.paymentPhone,
        paymentInstructions: post.tenant.paymentInstructions,
        error: post.tenant.paymentLink
          ? "Le paiement est effectué auprès du partenaire. L’accès reste bloqué jusqu’à sa confirmation."
          : "Le partenaire n’a pas encore configuré ses moyens de paiement.",
      }, { status: 201 });
    }
  }

  let provider: ReturnType<typeof getPaymentProvider>;
  try {
    provider = getPaymentProvider();
  } catch (error) {
    console.error("Payment provider is not configured.", error);
    return NextResponse.json({ error: "Aucun fournisseur de paiement n’est configuré. Les paiements réels ne sont pas disponibles." }, { status: 503 });
  }
  const isSasPay = provider instanceof SasPayPaymentProvider;
  const payer = isSasPay
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, name: true, country: true },
      })
    : null;
  if (isSasPay && !payer?.email) {
    return NextResponse.json({ error: "Ajoutez une adresse email à votre profil avant de payer avec SasPay." }, { status: 400 });
  }
  const configuredWebhookSecret = process.env.SASPAY_WEBHOOK_SECRET?.trim();
  if (isSasPay && configuredWebhookSecret && !process.env.APP_URL?.trim() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "APP_URL HTTPS est obligatoire en production lorsque le webhook SasPay est activé." },
      { status: 503 },
    );
  }

  let returnUrlBase = "";
  if (isSasPay) {
    const configuredUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.AUTH_URL?.trim();
    try {
      if (!configuredUrl) throw new Error("APP_URL n’est pas configurée.");
      const appUrl = new URL(configuredUrl);
      if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
        throw new Error("APP_URL doit utiliser HTTPS en production.");
      }
      appUrl.pathname = "/paiement/retour";
      appUrl.search = "";
      returnUrlBase = appUrl.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "URL de retour SasPay invalide.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }

  const reference = `wm_${randomUUID()}`;
  const payment = await prisma.payment.create({
    data: {
      userId: session.user.id,
      tenantId: paymentInput.tenantId,
      subscriptionId: paymentInput.subscriptionId,
      type: paymentInput.type,
      provider: isSasPay ? "saspay" : "mock",
      externalReference: reference,
      amount: paymentInput.amount,
      currency: paymentInput.currency,
      months: paymentInput.months,
      metadata: paymentInput.postId ? { postId: paymentInput.postId } : undefined,
    },
    select: { id: true, externalReference: true, amount: true, currency: true, status: true },
  });
  let returnUrl = "";
  if (isSasPay) {
    const redirectUrl = new URL(returnUrlBase);
    redirectUrl.searchParams.set("paymentId", payment.id);
    redirectUrl.searchParams.set("returnTo", paymentInput.returnTo);
    returnUrl = redirectUrl.toString();
  }
  let checkout: Awaited<ReturnType<typeof provider.createCheckout>>;
  try {
    checkout = await provider.createCheckout({
      paymentId: payment.id,
      amount: paymentInput.amount,
      currency: paymentInput.currency,
      description: paymentInput.title,
      customerEmail: payer?.email ?? "",
      customerName: payer?.name ?? "",
      country: countryCodeFromValue(payer?.country ?? "", "fr") || undefined,
      returnUrl,
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", processedAt: new Date() },
    });
    console.error("SasPay checkout creation failed.", {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : "Unknown provider error.",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de créer la session de paiement SasPay." },
      { status: 502 },
    );
  }
  const updatedPayment = checkout.providerPaymentId
    ? await prisma.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: checkout.providerPaymentId, checkoutUrl: checkout.checkoutUrl },
        select: { id: true, externalReference: true, amount: true, currency: true, status: true },
      })
    : payment;
  return NextResponse.json({
    payment: updatedPayment,
    checkoutUrl: checkout.checkoutUrl,
    testMode: checkout.provider === "mock",
    message: checkout.provider === "mock" ? "Paiement simulé en attente. Confirmez-le dans l’interface de test locale." : undefined,
  }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
  }

  const payments = await prisma.payment.findMany({
    where: {
      type: "PAID_PUBLICATION",
      provider: "manual",
      status: "PENDING",
      ...(session.user.role === "ADMIN" ? { tenant: { ownerId: session.user.id } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      amount: true,
      currency: true,
      createdAt: true,
      metadata: true,
      user: { select: { name: true } },
      tenant: { select: { displayName: true } },
    },
  });
  const postIds = payments.flatMap(({ metadata }) =>
    metadata && typeof metadata === "object" && "postId" in metadata && typeof metadata.postId === "string"
      ? [metadata.postId]
      : [],
  );
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, title: true },
  });
  const titles = new Map(posts.map(({ id, title }) => [id, title]));

  return NextResponse.json({
    payments: payments.map(({ metadata, ...payment }) => {
      const postId = metadata && typeof metadata === "object" && "postId" in metadata && typeof metadata.postId === "string"
        ? metadata.postId
        : null;
      return { ...payment, postTitle: postId ? titles.get(postId) ?? null : null };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
