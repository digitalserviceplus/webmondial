"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { LinkifiedText } from "@/components/linkified-text";
import { PostActions } from "@/components/post-actions";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

type PaidPost = {
  id: string;
  category: string;
  title: string | null;
  content: string;
  price: number | null;
  currency: string;
  mediaUrl: string | null;
  mediaType: "IMAGE" | "VIDEO" | null;
  createdAt: string;
  locked: boolean;
  _count: { likes: number };
  liked: boolean;
};

export function PublicPaidPosts({ tenantHandle }: { tenantHandle: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const locale = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR";
  const [posts, setPosts] = useState<PaidPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPostId, setBusyPostId] = useState("");
  const [message, setMessage] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/posts?tenant=${encodeURIComponent(tenantHandle)}&visibility=PAID&limit=30`, { cache: "no-store" });
      const result = await response.json() as { error?: string; posts?: PaidPost[] };
      if (!response.ok) throw new Error(result.error ?? labels.paidPostsLoadError);
      setPosts(result.posts ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.paidPostsLoadError);
    } finally {
      setLoading(false);
    }
  }, [tenantHandle, labels.paidPostsLoadError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function unlock(post: PaidPost) {
    setBusyPostId(post.id);
    setMessage("");
    setRequiresLogin(false);
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "publication", postId: post.id }),
      });
      const result = await response.json() as {
        error?: string;
        payment?: { id: string };
        checkoutUrl?: string | null;
        testMode?: boolean;
        manualPayment?: boolean;
        paymentPhone?: string | null;
        paymentInstructions?: string | null;
      };
      if (response.status === 401) {
        setRequiresLogin(true);
        throw new Error(labels.paidPostLoginRequired);
      }
      if (!response.ok) throw new Error(result.error ?? labels.paidPostPaymentError);
      if (result.manualPayment) {
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        throw new Error([result.paymentPhone, result.paymentInstructions, result.error].filter(Boolean).join(" · ") || labels.paidPartnerPaymentInfo);
      }
      if (result.testMode && result.payment) {
        const confirmation = await fetch(`/api/payments/${result.payment.id}/mock-confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: "SUCCEEDED" }),
        });
        if (!confirmation.ok) {
          const error = await confirmation.json().catch(() => ({})) as { error?: string };
          throw new Error(error.error ?? labels.paidPostPaymentError);
        }
        await load();
        return;
      }
      if (!result.checkoutUrl) throw new Error(labels.paidPostPaymentError);
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.paidPostPaymentError);
    } finally {
      setBusyPostId("");
    }
  }

  if (!loading && posts.length === 0 && !message) return null;

  return <section className="profile-feed">
    <div className="feed-heading"><div><span className="section-kicker">{labels.paidPostsKicker}</span><h2>{labels.paidPostsTitle}</h2></div></div>
    {message && <p className="dashboard-message" role="status">{message}</p>}
    {requiresLogin && <p className="panel-description">
      <Link href={`/connexion?tenant=${encodeURIComponent(tenantHandle)}`}>{labels.login}</Link>
      {" · "}
      <Link href={`/inscription?tenant=${encodeURIComponent(tenantHandle)}`}>{labels.joinSpace}</Link>
    </p>}
    {loading ? <div className="loading-inline"><LoaderCircle className="spin" size={18} /> {labels.loadingPosts}</div>
      : <div className="post-list">{posts.map((post) => <article className="post-card" key={post.id}>
        <div className="post-meta">
          <span className="post-category">{labels.paidPostBadge}</span>
          <span>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.createdAt))}</span>
        </div>
        {post.title && <h3 className="feed-post-title">{post.title}</h3>}
        {post.locked ? <div className="locked-content">
          <span className="locked-content-icon"><ShieldCheck size={21} /></span>
          <span className="locked-content-label">{labels.paidPostBadge}</span>
          <strong className="locked-content-price">{new Intl.NumberFormat(locale).format(post.price ?? 0)} {post.currency}</strong>
          <button className="button button-lime" type="button" onClick={() => void unlock(post)} disabled={busyPostId !== ""}>
            {busyPostId === post.id ? <><LoaderCircle className="spin" size={15} /> {labels.paymentRedirecting}</> : <>{labels.unlockContent} <ArrowRight size={15} /></>}
          </button>
        </div> : <>
          <p className="post-content"><LinkifiedText>{post.content}</LinkifiedText></p>
          {post.mediaUrl && post.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={post.mediaUrl} alt="" width={1200} height={900} unoptimized />}
          {post.mediaUrl && post.mediaType === "VIDEO" && <video className="post-media post-media-video" src={post.mediaUrl} controls preload="metadata" />}
        </>}
        <PostActions postId={post.id} href={`/${tenantHandle}#post-${post.id}`} initialLikes={post._count.likes} initialLiked={post.liked} />
      </article>)}</div>}
  </section>;
}
