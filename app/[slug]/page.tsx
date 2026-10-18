import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { io } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, CalendarDays, Trophy, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import LanguageSwitcher, { LocalizedDate, T } from "@/components/language-switcher";
import { LinkifiedText } from "@/components/linkified-text";
import { PostActions } from "@/components/post-actions";
import { PublicPaidPosts } from "@/components/public-paid-posts";
import CommunityShare from "@/components/community-share";
import AvatarImage from "@/components/avatar-image";
import { getSiteUrl } from "@/lib/site-url";

async function PublicSpace({ slug }: { slug: string }) {
  await io();
  const session = await auth();
  const tenant = await prisma.tenant.findFirst({
    where: { handle: slug.toLowerCase(), status: "ACTIVE" },
    select: {
      handle: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      owner: { select: { avatarUrl: true } },
      posts: {
        where: { published: true, status: "ACTIVE", visibility: "PUBLIC" },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          category: true,
          title: true,
          content: true,
          mediaUrl: true,
          mediaType: true,
          createdAt: true,
          _count: { select: { likes: true } },
          likes: session?.user.id ? { where: { userId: session.user.id }, select: { id: true }, take: 1 } : false,
        },
      },
      results: {
        where: { post: { published: true, status: "ACTIVE", visibility: "PUBLIC" } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          title: true,
          content: true,
          mediaUrl: true,
          mediaType: true,
          createdAt: true,
          post: { select: { id: true, title: true, category: true } },
        },
      },
    },
  });

  if (!tenant) {
    const alias = await prisma.tenantAlias.findUnique({
      where: { handle: slug.toLowerCase() },
      select: { tenant: { select: { handle: true, status: true } } },
    });
    if (alias?.tenant.status === "ACTIVE") permanentRedirect(`/${alias.tenant.handle}`);
    notFound();
  }
  const initials = tenant.displayName.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  const avatarUrl = tenant.avatarUrl ?? tenant.owner.avatarUrl;
  const biography = tenant.bio?.trim();
  const publicUrl = new URL(tenant.handle, getSiteUrl()).toString();

  return (
    <main className="public-space">
      <header className="site-header public-header">
        <Link className="brand" href="/">
          <span className="brand-mark"><Trophy size={18} /></span>
          <span>web<span className="brand-accent">mondial</span></span>
        </Link>
        <nav className="header-nav">
          <Link href="/"><T id="homeDiscover" /></Link>
          <LanguageSwitcher />
          <Link className="button button-small button-primary" href="/connexion"><T id="login" /></Link>
          <Link className="button button-small button-primary" href={`/inscription?tenant=${tenant.handle}`}>
            <T id="join" /> <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <div className="profile-cover">
        <span className="cover-label"><T id="publicSpace" /></span>
        <section className="profile-card" aria-label={tenant.displayName}>
          {avatarUrl
            ? <AvatarImage className="profile-avatar" src={avatarUrl} alt={`${tenant.displayName} profile`} size={104} />
            : <div className="profile-avatar">{initials || <UserRound size={30} />}</div>}
          <div className="profile-copy">
            <span className="profile-handle">@{tenant.handle}</span>
            <h1>{tenant.displayName}</h1>
            {biography && biography.toLocaleLowerCase() !== tenant.displayName.trim().toLocaleLowerCase() && biography.toLocaleLowerCase() !== tenant.handle.toLocaleLowerCase()
              ? <p>{biography}</p>
              : <p><T id="defaultTenantBio" /></p>}
          </div>
          <div className="profile-actions">
            <Link className="button button-lime profile-join" href={`/inscription?tenant=${tenant.handle}`}>
              <T id="joinSpace" /> <ArrowRight size={16} />
            </Link>
            <CommunityShare url={publicUrl} title={`${tenant.displayName} — Web Mondial`} />
          </div>
        </section>
      </div>

      <section className="profile-feed">
        <div className="feed-heading">
          <div>
            <span className="section-kicker"><T id="latestUpdates" /></span>
            <h2><T id="posts" /></h2>
          </div>
          <Link href="/" className="back-link"><ArrowLeft size={15} /> <T id="allSpaces" /></Link>
        </div>
        {tenant.posts.length === 0 ? (
          <div className="empty-feed">
            <span className="empty-icon"><Trophy size={20} /></span>
            <h3><T id="welcomeTo" /> @{tenant.handle}</h3>
            <p><T id="publicPostsDescription" /></p>
            <Link className="button button-dark" href={`/inscription?tenant=${tenant.handle}`}><T id="joinSpace" /> <ArrowRight size={15} /></Link>
          </div>
        ) : (
          <div className="post-list">
            {tenant.posts.map((post) => (
              <article className="post-card" key={post.id}>
                <div className="post-meta">
                  <span className="post-category"><T id={({
                    DAILY: "daily",
                    PREMIUM: "premium",
                    MONTANTE: "montante",
                    VIP: "vip",
                    FIXED: "fixed",
                    GROSSE_COTE: "grosseCote",
                    GENERAL: "publication",
                  } as Record<string, string>)[post.category] ?? "publication"} /></span>
                  <span><CalendarDays size={14} /> <LocalizedDate date={post.createdAt.toISOString()} /></span>
                </div>
                {post.title && <h3 className="feed-post-title">{post.title}</h3>}
                {avatarUrl && <div className="post-publisher">
                  <AvatarImage className="post-publisher-avatar" src={avatarUrl} alt="" size={38} />
                  <div className="post-publisher-identity"><strong>{tenant.displayName}</strong><small>@{tenant.handle}</small></div>
                </div>}
                <p className="post-content"><LinkifiedText>{post.content}</LinkifiedText></p>
                {post.mediaUrl && post.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={post.mediaUrl} alt="" width={1200} height={900} unoptimized />}
                {post.mediaUrl && post.mediaType === "VIDEO" && <video className="post-media post-media-video" src={post.mediaUrl} controls />}
                <PostActions
                  postId={post.id}
                  href={`/${tenant.handle}#post-${post.id}`}
                  initialLikes={post._count.likes}
                  initialLiked={Boolean(post.likes?.length)}
                />
              </article>
            ))}
          </div>
        )}
      </section>
      <PublicPaidPosts tenantHandle={tenant.handle} />
      {tenant.results.length > 0 && <section className="profile-feed">
        <div className="feed-heading"><div><span className="section-kicker"><T id="results" /></span><h2><T id="results" /></h2></div></div>
        <div className="post-list">{tenant.results.map((result) => <article className="post-card" id={`result-${result.id}`} key={result.id}>
          <div className="post-meta"><span className="post-category"><T id={({ DAILY: "daily", PREMIUM: "premium", MONTANTE: "montante", VIP: "vip", FIXED: "fixed", GROSSE_COTE: "grosseCote", GENERAL: "publication" } as Record<string, string>)[result.post.category] ?? "publication"} /></span><span><CalendarDays size={14} /> <LocalizedDate date={result.createdAt.toISOString()} /></span></div>
          <h3>{result.title || result.post.title || result.post.category}</h3>
          <p className="post-content"><LinkifiedText>{result.content}</LinkifiedText></p>
          {result.mediaUrl && result.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={result.mediaUrl} alt="" width={1200} height={900} unoptimized />}
          {result.mediaUrl && result.mediaType === "VIDEO" && <video className="post-media post-media-video" src={result.mediaUrl} controls />}
          <PostActions postId={result.post.id} href={`/${tenant.handle}#result-${result.id}`} initialLikes={0} initialLiked={false} allowLike={false} />
        </article>)}</div>
      </section>}
      <footer className="site-footer">
        <Link className="brand brand-footer" href="/">
          <span className="brand-mark"><Trophy size={16} /></span>
          <span>web<span className="brand-accent">mondial</span></span>
        </Link>
        <span><T id="publicPoweredBy" /></span>
        <Link href="/connexion"><T id="login" /></Link>
        <small className="footer-copyright"><T id="allRightsReserved" /></small>
      </footer>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await prisma.tenant.findFirst({
    where: { handle: slug.toLowerCase(), status: "ACTIVE" },
    select: { handle: true, displayName: true, bio: true, avatarUrl: true, owner: { select: { avatarUrl: true } } },
  });
  if (!tenant) return { title: "Espace introuvable | Web Mondial" };
  return {
    title: `${tenant.displayName} (@${tenant.handle}) | Web Mondial`,
    description: tenant.bio || `Suivez les actualités de ${tenant.displayName} sur Web Mondial.`,
    alternates: { canonical: new URL(tenant.handle, getSiteUrl()).toString() },
    openGraph: {
      title: `${tenant.displayName} | Web Mondial`,
      description: tenant.bio || `Suivez les actualités de ${tenant.displayName} sur Web Mondial.`,
      url: new URL(tenant.handle, getSiteUrl()).toString(),
      type: "profile",
      ...(tenant.avatarUrl || tenant.owner.avatarUrl ? { images: [tenant.avatarUrl ?? tenant.owner.avatarUrl!] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${tenant.displayName} (@${tenant.handle}) | Web Mondial`,
      description: tenant.bio || `Suivez les actualités de ${tenant.displayName} sur Web Mondial.`,
      ...(tenant.avatarUrl || tenant.owner.avatarUrl ? { images: [tenant.avatarUrl ?? tenant.owner.avatarUrl!] } : {}),
    },
  };
}

export default async function PublicSpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading">Chargement de l’espace…</main>}>
      <PublicSpaceParams params={params} />
    </Suspense>
  );
}

async function PublicSpaceParams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSpace slug={slug} />;
}
