"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  ArrowRight,
  Bell,
  Check,
  Copy,
  ExternalLink,
  Flag,
  Heart,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import PasswordInput from "@/components/password-input";
import { LinkifiedText } from "@/components/linkified-text";
import { applyPreferences } from "@/components/theme-provider";
import { messagesFor } from "@/lib/i18n";
import { useLanguage } from "@/components/language-switcher";
import { countryCodeFromValue, countryOptions } from "@/lib/countries";

type PostItem = {
  id: string;
  category: string;
  title: string | null;
  content: string;
  sport: string | null;
  visibility: string;
  price: number | null;
  currency: string;
  mediaUrl: string | null;
  mediaType: "IMAGE" | "VIDEO" | null;
  createdAt: string;
  _count: { likes: number; views?: number };
  liked: boolean;
  locked: boolean;
  purchased: boolean;
};

type ApiResult = { error?: string; [key: string]: unknown };

function readableTextColor(hex: string | null) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const rgb = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [0, 0, 0];
  const luminance = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] > 0.42 ? "#17212e" : "#ffffff";
}

async function sendJson(url: string, method: string, body?: unknown): Promise<ApiResult> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json().catch(() => ({}))) as ApiResult;
  if (!response.ok) throw new Error(result.error ?? `La requête a échoué (HTTP ${response.status}).`);
  return result;
}

const browserMediaTypes: Record<string, { extension: string; mediaType: "IMAGE" | "VIDEO" }> = {
  "image/jpeg": { extension: "jpg", mediaType: "IMAGE" },
  "image/png": { extension: "png", mediaType: "IMAGE" },
  "image/gif": { extension: "gif", mediaType: "IMAGE" },
  "image/webp": { extension: "webp", mediaType: "IMAGE" },
  "video/mp4": { extension: "mp4", mediaType: "VIDEO" },
  "video/webm": { extension: "webm", mediaType: "VIDEO" },
};

async function uploadMediaFile(file: File, purpose: "post" | "avatar", errorMessage: string) {
  const labels = messagesFor(document.documentElement.lang);
  if (file.size > 20 * 1024 * 1024) throw new Error(labels.uploadFileTooLarge);
  const supportedType = browserMediaTypes[file.type];
  const isProductionOrigin = window.location.protocol === "https:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";

  if (isProductionOrigin) {
    if (!supportedType) throw new Error(labels.unsupportedMedia);
    const id = crypto.randomUUID();
    const pathname = `media/${id}.${supportedType.extension}`;
    const blob = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/media",
      clientPayload: JSON.stringify({ id, purpose, contentType: file.type }),
      contentType: file.type,
      multipart: file.size > 5 * 1024 * 1024,
    });
    if (blob.pathname !== pathname) throw new Error(labels.mediaUnexpected);
    return { url: `/api/media/${id}`, mediaType: supportedType.mediaType };
  }

  const form = new FormData();
  form.set("file", file);
  form.set("purpose", purpose);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const result = await response.json().catch(() => ({})) as ApiResult & { url?: string; mediaType?: "IMAGE" | "VIDEO" };
  if (!response.ok || !result.url || !result.mediaType) {
    throw new Error(result.error ?? errorMessage);
  }
  return { url: result.url, mediaType: result.mediaType };
}

function Message({ value, onClose }: { value: string; onClose: () => void }) {
  const labels = messagesFor(useLanguage());
  if (!value) return null;
  return <div className="dashboard-message" role="status"><span>{value}</span><button type="button" onClick={onClose} aria-label={labels.close}>×</button></div>;
}

function Feed({ tenantHandle, category, managePosts = false, refreshToken = 0 }: { tenantHandle: string; category?: string; managePosts?: boolean; refreshToken?: number }) {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [tenantProfile, setTenantProfile] = useState<{ displayName: string; avatarUrl: string | null; handle: string } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlockingPostId, setUnlockingPostId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const language = useLanguage();
  const labels = messagesFor(language);
  const locale = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR";
  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ tenant: tenantHandle, limit: "20" });
      if (category) params.set("category", category);
      if (cursor) params.set("cursor", cursor);
      const result = await sendJson(`/api/posts?${params}`, "GET") as {
        posts: PostItem[];
        nextCursor: string | null;
        tenant: { handle: string; displayName: string; avatarUrl: string | null };
      };
      setPosts((current) => cursor ? [...current, ...result.posts] : result.posts);
      setNextCursor(result.nextCursor);
      setTenantProfile(result.tenant);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.resultLoadError);
    } finally {
      setBusy(false);
    }
  }, [tenantHandle, category, labels.resultLoadError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  async function toggleLike(post: PostItem) {
    try {
      await sendJson(`/api/posts/${post.id}/like`, post.liked ? "DELETE" : "POST");
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, liked: !item.liked, _count: { ...item._count, likes: item._count.likes + (item.liked ? -1 : 1) } }
        : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }

  async function share(post: PostItem) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${tenantHandle}#post-${post.id}`);
      setError(labels.shareSuccess);
    } catch {
      setError(labels.shareError);
    }
  }

  async function shareCommunity() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${tenantHandle}`);
      setError(labels.shareSuccess);
    } catch {
      setError(labels.shareError);
    }
  }

  async function updatePost(post: PostItem, form: HTMLFormElement) {
    const values = new FormData(form);
    try {
      await sendJson("/api/posts", "PATCH", {
        id: post.id,
        title: String(values.get("title") ?? ""),
        category: String(values.get("category")),
        content: String(values.get("content") ?? ""),
        sport: String(values.get("sport") ?? ""),
        visibility: post.visibility,
        price: post.price ?? undefined,
        mediaUrl: post.mediaUrl ?? undefined,
        mediaType: post.mediaType ?? undefined,
      });
      setError(labels.postUpdated);
      setEditingPostId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.postUpdateError);
    }
  }

  async function deletePost(post: PostItem) {
    if (!window.confirm(labels.confirmDeletePost)) return;
    try {
      await sendJson(`/api/posts?id=${encodeURIComponent(post.id)}`, "DELETE");
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setError(labels.postDeleted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.postDeleteError);
    }
  }

  async function unlock(post: PostItem) {
    if (unlockingPostId) return;
    setUnlockingPostId(post.id);
    try {
      const result = await sendJson("/api/payments", "POST", { type: "publication", postId: post.id }) as {
        payment: { id: string };
        testMode: boolean;
        checkoutUrl: string | null;
        manualPayment?: boolean;
        paymentPhone?: string | null;
        paymentInstructions?: string | null;
        error?: string;
      };
      if (result.manualPayment) {
        if (result.checkoutUrl && typeof result.checkoutUrl === "string") {
          window.location.assign(result.checkoutUrl);
          return;
        }
        const details = [
          result.paymentPhone ? `${labels.paymentPhoneLabel} : ${result.paymentPhone}` : "",
          result.paymentInstructions,
          result.error,
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        setError(details.join(" · "));
        return;
      } else if (result.testMode) {
        await sendJson(`/api/payments/${result.payment.id}/mock-confirm`, "POST", { result: "SUCCEEDED" });
        await load();
        return;
      }
      if (!result.checkoutUrl) throw new Error(labels.checkoutUnavailable);
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.paidPostPaymentError);
    } finally {
      setUnlockingPostId(null);
    }
  }

  return (
    <div className="tool-panel">
      <Message value={error} onClose={() => setError("")} />
      {posts.length === 0 && !busy ? (
        <div className="empty-feed"><span className="empty-icon"><ShieldCheck size={20} /></span><h3>{labels.emptyPostsTitle}</h3><p>{labels.emptyPostsText}</p></div>
      ) : (
        <div className="post-list">
          {posts.map((post) => (
            <article className="post-card" id={`post-${post.id}`} key={post.id}>
              {tenantProfile && <div className="post-publisher">
                {tenantProfile.avatarUrl
                  ? <Image className="post-publisher-avatar" src={tenantProfile.avatarUrl} alt="" width={38} height={38} unoptimized />
                  : <span className="post-publisher-avatar post-publisher-initial">{tenantProfile.displayName.slice(0, 1).toUpperCase()}</span>}
                <div><strong>{tenantProfile.displayName}</strong><small>@{tenantProfile.handle}</small></div>
                <Link href={`/${tenantProfile.handle}`} target="_blank">{labels.publicProfile} <ExternalLink size={13} /></Link>
                <button className="text-action" type="button" onClick={() => void shareCommunity()}><Copy size={14} /> {labels.copyCommunityLink}</button>
              </div>}
              <div className="post-meta"><span className="post-category">{({
                DAILY: labels.dailyPost, PREMIUM: labels.premiumPost, MONTANTE: labels.montantePost,
                VIP: labels.vipPost, FIXED: labels.fixedPost, GROSSE_COTE: labels.grosseCotePost,
                GENERAL: labels.posts,
              } as Record<string, string>)[post.category] ?? labels.posts}</span><span>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.createdAt))}</span></div>
              {post.title && <h3 className="feed-post-title">{post.title}</h3>}
              {post.sport && <span className="sport-pill">{post.sport}</span>}
              <p className="post-content"><LinkifiedText>{post.content}</LinkifiedText></p>
              {post.locked && (
                <div className="locked-content">
                  <span className="locked-content-icon"><ShieldCheck size={21} /></span>
                  <span className="locked-content-label">{labels.premiumContent}</span>
                  <strong className="locked-content-price">{new Intl.NumberFormat(locale).format(post.price ?? 0)} {post.currency}</strong>
                  <button className="button button-lime" type="button" onClick={() => void unlock(post)} disabled={unlockingPostId !== null}>
                    {unlockingPostId === post.id ? <><LoaderCircle className="spin" size={15} /> {labels.paymentRedirecting}</> : <>{labels.unlockContent} <ArrowRight size={15} /></>}
                  </button>
                </div>
              )}
              {!post.locked && post.mediaUrl && post.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={post.mediaUrl} alt="" width={1200} height={900} unoptimized />}
              {!post.locked && post.mediaUrl && post.mediaType === "VIDEO" && <video className="post-media post-media-video" src={post.mediaUrl} controls preload="metadata" />}
              <div className="post-footer">
                <button type="button" className={`like-button ${post.liked ? "liked" : ""}`} onClick={() => void toggleLike(post)} aria-label={post.liked ? labels.unlike : labels.like}><Heart size={16} /> {post._count.likes}</button>
                {managePosts && <span>{post._count.views ?? 0} {labels.views}</span>}
                <button type="button" className="text-action" onClick={() => void share(post)}><Copy size={14} /> {labels.share}</button>
                {managePosts && <div className="post-management">
                  {now !== null && now - new Date(post.createdAt).getTime() <= 10 * 60_000 && <button className="text-action" type="button" onClick={() => setEditingPostId(editingPostId === post.id ? null : post.id)}>{labels.editPost}</button>}
                  <button className="text-action post-delete-action" type="button" onClick={() => void deletePost(post)}>{labels.deletePost}</button>
                </div>}
              </div>
              {managePosts && editingPostId === post.id && <form className="panel-form post-edit-form" onSubmit={(event) => { event.preventDefault(); void updatePost(post, event.currentTarget); }}>
                <label>{labels.postTitle}<input className="text-field" name="title" defaultValue={post.title ?? ""} maxLength={180} /></label>
                <label>{labels.postCategory}<select className="text-field" name="category" defaultValue={post.category}>
                  {["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE", "GENERAL"].map((item) => <option key={item} value={item}>{({
                    DAILY: labels.dailyPost, PREMIUM: labels.premiumPost, MONTANTE: labels.montantePost,
                    VIP: labels.vipPost, FIXED: labels.fixedPost, GROSSE_COTE: labels.grosseCotePost, GENERAL: labels.posts,
                  } as Record<string, string>)[item]}</option>)}
                </select></label>
                <label>{labels.postContent}<textarea className="text-field text-area" name="content" required maxLength={20000} rows={5} defaultValue={post.content} /></label>
                <label>{labels.postSport}<input className="text-field" name="sport" defaultValue={post.sport ?? ""} maxLength={50} /></label>
                <div className="admin-actions"><button className="button button-primary" type="submit">{labels.save}</button><button className="button button-dark" type="button" onClick={() => setEditingPostId(null)}>{labels.cancel}</button></div>
              </form>}
            </article>
          ))}
        </div>
      )}
      {busy && <div className="loading-inline"><LoaderCircle className="spin" size={18} /> {labels.loadingPosts}</div>}
      {!busy && nextCursor && <button className="button button-dark panel-load-more" type="button" onClick={() => void load(nextCursor)}>{labels.olderPosts} <ArrowRight size={15} /></button>}
    </div>
  );
}

function PostComposer({
  tenantHandle,
  initialCategory,
  canPublishPaid,
  onPublished,
}: {
  tenantHandle: string;
  initialCategory?: string;
  canPublishPaid: boolean;
  onPublished: () => void;
}) {
  const labels = messagesFor(useLanguage());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState("TENANT_PLAYERS");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const price = form.get("price") ? Number(form.get("price")) : undefined;
    try {
      const mediaFile = form.get("mediaFile");
      let mediaUrl = String(form.get("mediaUrl") ?? "") || undefined;
      let mediaType = String(form.get("mediaType") ?? "") || undefined;
      if (mediaFile instanceof File && mediaFile.size > 0) {
        const uploaded = await uploadMediaFile(mediaFile, "post", labels.mediaUploadError);
        mediaUrl = uploaded.url;
        mediaType = uploaded.mediaType;
      }
      await sendJson("/api/posts", "POST", {
        title: String(form.get("title") ?? ""),
        content: String(form.get("content") ?? ""),
        category: String(form.get("category")),
        sport: String(form.get("sport") ?? ""),
        visibility,
        price,
        mediaUrl,
        mediaType,
      });
      setMessage(labels.postPublished);
      formElement.reset();
      setVisibility("TENANT_PLAYERS");
      onPublished();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.publishError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tool-section">
      <h2>{labels.createPost}</h2>
      <p className="panel-description">{labels.postVisibilityHint.replace("{handle}", tenantHandle)}</p>
      <Message value={message} onClose={() => setMessage("")} />
      <form className="panel-form" onSubmit={submit}>
        <label>{labels.postTitle} <span>({labels.optional})</span><input className="text-field" name="title" maxLength={180} placeholder={labels.postTitlePlaceholder} /></label>
        <div className="form-row">
          <label>{labels.postCategory}<select className="text-field" name="category" defaultValue={initialCategory ?? "DAILY"}>{["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE", "GENERAL"].map((item) => <option key={item} value={item}>{({
            DAILY: labels.dailyPost,
            PREMIUM: labels.premiumPost,
            MONTANTE: labels.montantePost,
            VIP: labels.vipPost,
            FIXED: labels.fixedPost,
            GROSSE_COTE: labels.grosseCotePost,
            GENERAL: labels.posts,
          } as Record<string, string>)[item]}</option>)}</select></label>
          <label>{labels.postSport}<input className="text-field" name="sport" maxLength={50} placeholder={labels.sportPlaceholder} /></label>
        </div>
        <label>{labels.postContent}<textarea className="text-field text-area" name="content" required maxLength={20000} rows={6} placeholder={labels.postContentPlaceholder} /></label>
        <label>{labels.postVisibility}<select className="text-field" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="TENANT_PLAYERS">{labels.communityVisibility}</option><option value="PUBLIC">{labels.publicVisibility}</option><option value="PRIVATE">{labels.privateVisibility}</option><option value="PAID" disabled={!canPublishPaid}>{labels.paidVisibility}{canPublishPaid ? "" : ` (${labels.annualSubscriptionRequired})`}</option></select></label>
        {!canPublishPaid && <p className="form-legal">{labels.postAnnualRequired}</p>}
        {visibility === "PAID" && <label>{labels.price} (XOF)<input className="text-field" type="number" min="1" step="1" name="price" required /></label>}
        <div className="form-row">
          <label>{labels.mediaUrl} <span>({labels.optional})</span><input className="text-field" type="url" name="mediaUrl" placeholder="https://…" /></label>
          <label>{labels.postMediaType}<select className="text-field" name="mediaType"><option value="">{labels.noMedia}</option><option value="IMAGE">{labels.image}</option><option value="VIDEO">{labels.video}</option></select></label>
        </div>
        <label>{labels.uploadMedia} <span>({labels.maxUploadSize})</span><input className="text-field" type="file" name="mediaFile" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm" /></label>
        <p className="form-legal">{labels.mediaUploadDetails}</p>
        <button className="button button-lime" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} {labels.publishPost}</button>
      </form>
    </section>
  );
}

function PartnerApplication() {
  const labels = messagesFor(useLanguage());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await sendJson("/api/partnerships", "POST", {
        requestedDisplayName: String(form.get("displayName")),
        requestedHandle: String(form.get("handle")),
        bio: String(form.get("bio") ?? ""),
      });
      setMessage(labels.partnerRequestSent);
      formElement.reset();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.sendFailed);
    } finally {
      setBusy(false);
    }
  }
  return <section className="tool-section"><h2>{labels.partner}</h2><p className="panel-description">{labels.partnerIntro}</p><Message value={message} onClose={() => setMessage("")} /><form className="panel-form" onSubmit={submit}><label>{labels.desiredPublicName}<input className="text-field" name="displayName" required minLength={2} maxLength={80} /></label><label>{labels.desiredHandle}<input className="text-field" name="handle" required pattern="[a-zA-Z0-9-]+" maxLength={40} placeholder={labels.workspacePlaceholder} /><small>{labels.handleFormat}</small></label><label>{labels.presentation}<textarea className="text-field text-area" name="bio" maxLength={1000} rows={4} /></label><button className="button button-lime" disabled={busy}>{busy ? labels.sending : labels.sendPartnerRequest} <ArrowRight size={15} /></button></form></section>;
}

function Agreement({ tenantHandle }: { tenantHandle: string }) {
  const labels = messagesFor(useLanguage());
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  async function accept() {
    try {
      await sendJson("/api/partnerships/accept", "POST", { accepted: true });
      setMessage(labels.agreementAccepted);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.saveGeneric);
    }
  }
  return <div className="agreement-controls"><label className="checkbox-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> {labels.acceptTerms}</label><button type="button" className="button button-lime" disabled={!accepted} onClick={() => void accept()}>{labels.acceptTermsButton} <Check size={15} /></button><Message value={message} onClose={() => setMessage("")} /><Link href={`/${tenantHandle}`}>{labels.viewSpace}</Link></div>;
}

function SubscriptionPanel({
  subscription,
}: {
  subscription: { status: string; paidMonths: number; trialEndsAt?: Date | string | null; currentPeriodEnd?: Date | string; plan: { monthlyPrice: number; currency: string; trialDays: number } } | null;
}) {
  const router = useRouter();
  const labels = messagesFor(useLanguage());
  const [months, setMonths] = useState(1);
  const [busyPlan, setBusyPlan] = useState<"monthly" | "annual" | null>(null);
  const [message, setMessage] = useState("");
  const checkoutInProgress = useRef(false);
  async function checkout(plan: "monthly" | "annual", paidMonths?: number) {
    if (checkoutInProgress.current) {
      setMessage(labels.checkoutInProgress);
      return;
    }
    checkoutInProgress.current = true;
    setBusyPlan(plan);
    setMessage("");
    try {
      const result = await sendJson("/api/payments", "POST", plan === "annual"
        ? { type: "subscription", plan: "annual" }
        : { type: "subscription", plan: "monthly", months: paidMonths ?? 1 }) as {
        payment: { id: string };
        testMode: boolean;
        checkoutUrl: string | null;
        message?: string;
      };
      if (result.testMode) {
        setMessage(labels.simulatedPayment);
        await sendJson(`/api/payments/${result.payment.id}/mock-confirm`, "POST", { result: "SUCCEEDED" });
        setMessage(labels.testPaymentConfirmed);
        router.refresh();
      } else if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
      } else {
        setMessage(result.message ?? labels.checkoutUnavailable);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Paiement indisponible.");
    } finally {
      checkoutInProgress.current = false;
      setBusyPlan(null);
    }
  }
  const monthlyPrice = subscription?.plan.monthlyPrice ?? 0;
  const bonusMonths = months >= 2 ? 1 : 0;
  const bonusDays = months === 1 ? 7 : 0;
  const trialActive = subscription?.status === "TRIAL" && subscription.trialEndsAt && new Date(subscription.trialEndsAt) > new Date();
  const expired = Boolean(subscription && subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) <= new Date());
  const currency = subscription?.plan.currency ?? "XOF";
  const trialDays = subscription?.plan.trialDays ?? 3;
  const language = useLanguage();
  const locale = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR";
  const formatPrice = (amount: number) => `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  const trialStatus = trialActive
    ? labels.trialActiveUntil.replace("{date}", new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(subscription!.trialEndsAt!)))
    : expired
      ? labels.trialExpired
      : labels.trialAvailable.replace("{days}", String(trialDays));
  return (
    <section className="tool-section subscription-section">
      <header className="subscription-intro">
        <span className="section-kicker">{labels.subscriptionIntroKicker}</span>
        <h2>{labels.subscriptionIntroTitle}</h2>
        <p>{labels.subscriptionIntroDescription}</p>
      </header>
      <div className="subscription-status" role="status"><ShieldCheck size={16} /> {trialStatus}</div>
      <div className="subscription-plans">
        <article className="subscription-option">
          <span className="section-kicker">{labels.trialHeading}</span>
          <h3>{labels.trialTitle}</h3>
          <strong className="subscription-option-price">{trialDays} {labels.days} · {formatPrice(0)}</strong>
          <p>{labels.trialDescription}</p>
          <span className="subscription-plan-note">{trialActive ? labels.trialInProgress : labels.trialNoAction}</span>
        </article>
        <article className="subscription-option">
          <span className="section-kicker">{labels.monthlyHeading}</span>
          <h3>{labels.monthlyTitle}</h3>
          <p>{labels.monthlyDescription}</p>
          <label>{labels.monthsLabel}<select className="text-field" value={months} onChange={(event) => setMonths(Number(event.target.value))}>{Array.from({ length: 11 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month} {month === 1 ? labels.monthSingular : labels.monthPlural}</option>)}</select></label>
          <div className="subscription-math">
            <span>{formatPrice(monthlyPrice)} × {months} {labels.monthPlural}</span>
            <strong>{formatPrice(monthlyPrice * months)}</strong>
            <small>{labels.bonusLabel} : {bonusMonths ? labels.oneMonthFree : labels.daysFree.replace("{days}", String(bonusDays))} · {labels.accessLabel} : {months === 1 ? labels.thirtySevenDays : labels.monthsOfAccess.replace("{months}", String(months + bonusMonths))}</small>
          </div>
          <button className="button button-lime" type="button" onClick={() => void checkout("monthly", months)} disabled={busyPlan === "monthly" || monthlyPrice <= 0}>
            {busyPlan === "monthly" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} {labels.choosePlan}
          </button>
        </article>
        <article className="subscription-option subscription-option-featured">
          <span className="section-kicker">{labels.annualHeading}</span>
          <h3>{labels.annualTitle}</h3>
          <p>{labels.annualDescription}</p>
          <div className="subscription-math">
            <span>{formatPrice(monthlyPrice)} × 12 {labels.monthPlural}</span>
            <strong>{formatPrice(monthlyPrice * 12)}</strong>
            <small>{labels.annualMonthsSummary}</small>
          </div>
          <button className="button button-lime" type="button" onClick={() => void checkout("annual")} disabled={busyPlan === "annual" || monthlyPrice <= 0}>
            {busyPlan === "annual" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} {labels.chooseAnnualPlan}
          </button>
        </article>
      </div>
      {monthlyPrice <= 0 && <p className="form-error">{labels.priceMissing}</p>}
      <p className="form-legal">{labels.securePayment}</p>
      <Message value={message} onClose={() => setMessage("")} />
    </section>
  );
}

function BookmakerManager({ canManage }: { canManage: boolean }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  type Bookmaker = {
    id: string;
    name: string;
    signupUrl: string;
    promoCode: string | null;
    videoUrl: string | null;
    logoUrl: string | null;
    brandColor: string | null;
    active: boolean;
  };
  const [bookmakers, setBookmakers] = useState<Bookmaker[]>([]);
  const [editing, setEditing] = useState<Bookmaker | null>(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await sendJson("/api/bookmakers", "GET") as { bookmakers: typeof bookmakers };
      setBookmakers(result.bookmakers);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : messagesFor(language).loadingGeneric); }
  }, [language]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await sendJson("/api/bookmakers", "POST", Object.fromEntries(form.entries()));
      formElement.reset();
      setEditing(null);
      setMessage(editing ? labels.bookmakerUpdated : labels.bookmakerAdded);
      await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); }
  }
  async function remove(id: string) {
    try {
      await sendJson(`/api/bookmakers?id=${id}`, "DELETE");
      await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.deleteGeneric); }
  }
  return (
    <section className="tool-section">
      {canManage && <p className="panel-description">{labels.bookmakerLinks}</p>}
      <Message value={message} onClose={() => setMessage("")} />
      {canManage && (
        <form className="panel-form bookmaker-form" key={editing?.id ?? "new-bookmaker"} onSubmit={submit}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <label>{labels.bookmakerName}<input className="text-field" name="name" required maxLength={100} defaultValue={editing?.name ?? ""} /></label>
          <label>{labels.bookmakerPromo}<input className="text-field" name="promoCode" maxLength={80} defaultValue={editing?.promoCode ?? ""} /></label>
          <label>{labels.bookmakerSignup}<input className="text-field" name="signupUrl" type="url" required placeholder="https://…" defaultValue={editing?.signupUrl ?? ""} /></label>
          <label>{labels.bookmakerVideo}<input className="text-field" name="videoUrl" type="url" required placeholder="https://…" defaultValue={editing?.videoUrl ?? ""} /></label>
          <label>{labels.logoHttps}<input className="text-field" name="logoUrl" type="url" placeholder="https://…" defaultValue={editing?.logoUrl ?? ""} /></label>
          <label>{labels.brandColor}<input className="text-field" name="brandColor" type="color" defaultValue={editing?.brandColor ?? "#5b9cff"} /></label>
          <label className="checkbox-label"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" value="true" defaultChecked={editing?.active ?? true} /> {labels.visibleToPlayers}</label>
          <div className="admin-actions">
            <button className="button button-primary" type="submit"><Plus size={15} /> {editing ? labels.saveChanges : labels.bookmakerAdd}</button>
            {editing && <button className="button button-dark" type="button" onClick={() => setEditing(null)}>{labels.cancel}</button>}
          </div>
        </form>
      )}
      {bookmakers.length > 0
        ? <div className="bookmaker-list">{bookmakers.map((item) => (
            <article className="bookmaker-card" key={item.id} style={{ backgroundColor: item.brandColor || "#2868b8", borderColor: item.brandColor || "#2868b8", color: readableTextColor(item.brandColor) }}>
              <div className="bookmaker-card-brand">
                {item.logoUrl && <Image src={item.logoUrl} alt="" width={48} height={48} unoptimized />}
                <div>
                  <strong>{item.name}</strong>
                  {item.promoCode && <span className="bookmaker-promo"><span>{labels.promoCode}</span><b>{item.promoCode}</b></span>}
                  {canManage && !item.active && <span>{labels.hidden}</span>}
                </div>
              </div>
              <div className="bookmaker-card-links">
                {item.videoUrl
                  ? <a className="button button-light bookmaker-card-button" href={item.videoUrl} target="_blank" rel="noopener noreferrer">{labels.bookmakerVideoAction} <ExternalLink size={14} /></a>
                  : <span className="button button-light bookmaker-card-button" aria-disabled="true">{labels.bookmakerVideoMissing}</span>}
                <a className="button button-light bookmaker-card-button" href={item.signupUrl} target="_blank" rel="noopener noreferrer">{labels.bookmakerJoin} <ExternalLink size={14} /></a>
              </div>
              {canManage && <div className="bookmaker-card-management"><button className="button button-light button-small" type="button" onClick={() => setEditing(item)}>{labels.bookmakerEdit}</button><button className="button button-light button-small" type="button" onClick={() => void remove(item.id)} aria-label={`${labels.bookmakerDelete} ${item.name}`}><Trash2 size={15} /> {labels.bookmakerDelete}</button></div>}
            </article>
          ))}</div>
        : <div className="empty-feed"><h3>{canManage ? labels.bookmakerNoAdded : labels.bookmakerNoAvailable}</h3><p>{canManage ? labels.bookmakerEmptyAdmin : labels.bookmakerPlayerEmpty}</p></div>}
    </section>
  );
}

function ResultsManager({ tenantHandle }: { tenantHandle: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  type EligiblePost = {
    id: string;
    title: string | null;
    category: string;
    publishedAt: string;
    result: { id: string; title: string | null; content: string; mediaUrl: string | null; mediaType: "IMAGE" | "VIDEO" | null } | null;
  };
  const [posts, setPosts] = useState<EligiblePost[]>([]);
  const [postId, setPostId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedPost = posts.find((post) => post.id === postId) ?? null;
  const refresh = useCallback(async () => {
    try {
      const result = await sendJson(`/api/results?tenant=${encodeURIComponent(tenantHandle)}&manage=1`, "GET") as { posts: EligiblePost[] };
      setPosts(result.posts);
      setPostId((current) => current && result.posts.some((post) => post.id === current) ? current : result.posts[0]?.id ?? "");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.resultLoadError);
    }
  }, [tenantHandle, labels.resultLoadError]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!postId) return;
    setBusy(true);
    setMessage("");
    try {
      let mediaUrl = String(form.get("mediaUrl") ?? "").trim();
      let mediaType = String(form.get("mediaType") ?? "") || undefined;
      const mediaFile = form.get("mediaFile");
      if (mediaFile instanceof File && mediaFile.size > 0) {
        const uploaded = await uploadMediaFile(mediaFile, "post", labels.resultUploadError);
        mediaUrl = uploaded.url;
        mediaType = uploaded.mediaType;
      }
      await sendJson("/api/results", "POST", {
        postId,
        title: String(form.get("title") ?? ""),
        content: String(form.get("content") ?? ""),
        mediaUrl: mediaUrl || undefined,
        mediaType,
      });
      setMessage(labels.resultPublished);
      formElement.reset();
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.resultSaveError);
    } finally {
      setBusy(false);
    }
  }

  return <section className="tool-section">
    <h2>{labels.results}</h2>
    {posts.length ? <>
      <form className="panel-form" key={selectedPost?.id ?? "no-post"} onSubmit={submit}>
        <label>{labels.resultPost}<select className="text-field" value={postId} onChange={(event) => setPostId(event.target.value)} required>
          {posts.map((post) => <option value={post.id} key={post.id}>
            {post.title || post.category} · {new Intl.DateTimeFormat(language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR", { timeStyle: "short" }).format(new Date(post.publishedAt))}
          </option>)}
        </select></label>
        <label>{labels.resultTitle}<input className="text-field" name="title" maxLength={180} key={`${selectedPost?.id ?? "no-post"}-title`} defaultValue={selectedPost?.result?.title ?? ""} /></label>
        <label>{labels.resultContent}<textarea className="text-field text-area" name="content" required maxLength={20000} rows={5} key={selectedPost?.id ?? "no-post"} defaultValue={selectedPost?.result?.content ?? ""} /></label>
        <div className="form-row">
          <label>{labels.resultMedia}<input className="text-field" name="mediaUrl" type="url" placeholder="https://…" key={`${selectedPost?.id ?? "no-post"}-media`} defaultValue={selectedPost?.result?.mediaUrl ?? ""} /></label>
          <label>{labels.postMediaType}<select className="text-field" name="mediaType" key={`${selectedPost?.id ?? "no-post"}-type`} defaultValue={selectedPost?.result?.mediaType ?? ""}><option value="">{labels.noMedia}</option><option value="IMAGE">{labels.image}</option><option value="VIDEO">{labels.video}</option></select></label>
        </div>
        <label>{labels.uploadMedia}<input className="text-field" name="mediaFile" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm" /></label>
        <Message value={message} onClose={() => setMessage("")} />
        <button className="button button-lime" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} {labels.saveResult}</button>
      </form>
      <div className="admin-list">{posts.filter((post) => post.result).map((post) => <article className="admin-card" key={post.id}>
        <strong>{post.title || post.category}</strong><span>{post.result?.title || labels.results}</span><p><LinkifiedText>{post.result?.content ?? ""}</LinkifiedText></p>
        {post.result?.mediaUrl && post.result.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={post.result.mediaUrl} alt="" width={1200} height={900} unoptimized />}
        {post.result?.mediaUrl && post.result.mediaType === "VIDEO" && <video className="post-media post-media-video" src={post.result.mediaUrl} controls preload="metadata" />}
      </article>)}</div>
    </> : <div className="empty-feed"><h3>{labels.resultEmpty}</h3></div>}
  </section>;
}

function ResultsFeed({ tenantHandle }: { tenantHandle: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const locale = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR";
  const [results, setResults] = useState<Array<{
    id: string;
    title: string | null;
    content: string;
    mediaUrl: string | null;
    mediaType: "IMAGE" | "VIDEO" | null;
    createdAt: string;
    post: { id: string; title: string | null; category: string };
  }>>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void sendJson(`/api/results?tenant=${encodeURIComponent(tenantHandle)}`, "GET")
        .then((result) => {
          if (active) setResults(result.results as typeof results);
        })
        .catch((cause: unknown) => {
          if (active) setMessage(cause instanceof Error ? cause.message : labels.resultLoadError);
        })
        .finally(() => { if (active) setBusy(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [tenantHandle, labels.resultLoadError]);

  return <section className="tool-section">
    <h2>{labels.results}</h2>
    <Message value={message} onClose={() => setMessage("")} />
    {busy ? <div className="loading-inline"><LoaderCircle className="spin" size={18} /> {labels.loadingPosts}</div>
      : results.length ? <div className="post-list">{results.map((result) => <article className="post-card" key={result.id}>
      <div className="post-meta">
        <span className="post-category">{({
          DAILY: labels.dailyPost, PREMIUM: labels.premiumPost, MONTANTE: labels.montantePost,
          VIP: labels.vipPost, FIXED: labels.fixedPost, GROSSE_COTE: labels.grosseCotePost,
        } as Record<string, string>)[result.post.category] ?? labels.posts}</span>
        <span>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(result.createdAt))}</span>
      </div>
      <h3 className="feed-post-title">{result.title || result.post.title || labels.results}</h3>
      <p className="post-content"><LinkifiedText>{result.content}</LinkifiedText></p>
      {result.mediaUrl && result.mediaType === "IMAGE" && <Image className="post-media post-media-image" src={result.mediaUrl} alt="" width={1200} height={900} unoptimized />}
      {result.mediaUrl && result.mediaType === "VIDEO" && <video className="post-media post-media-video" src={result.mediaUrl} controls preload="metadata" />}
      <Link className="text-action" href={`/${tenantHandle}#post-${result.post.id}`}>{labels.sourceCoupon}</Link>
    </article>)}</div> : <div className="empty-feed"><h3>{labels.noPublicResults}</h3></div>}
  </section>;
}

function AdminTools({ tab }: { tab: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const statusLabel = (status: string) => ({
    ACTIVE: labels.statusActive,
    PENDING: labels.statusPending,
    SUSPENDED: labels.statusSuspended,
    ARCHIVED: labels.statusArchived,
  }[status] ?? status);
  const [tenants, setTenants] = useState<Array<{ id: string; handle: string; displayName: string; status: string; suspensionReason: string | null; owner: { name: string; email: string | null }; _count: { members: number; posts: number; reports: number }; subscription: { status: string; paidMonths: number } | null }>>([]);
  const [applications, setApplications] = useState<Array<{ id: string; requestedHandle: string; requestedDisplayName: string; status: string; user: { name: string; email: string | null } }>>([]);
  const [reports, setReports] = useState<Array<{ id: string; reason: string; description: string; status: string; tenant: { handle: string; displayName: string }; author: { name: string } }>>([]);
  const [identifierRequests, setIdentifierRequests] = useState<Array<{ id: string; oldHandle: string; requestedHandle: string; reason: string; status: string; tenant: { handle: string; displayName: string } }>>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const refresh = useCallback(async () => {
    try {
      if (tab === "admins") {
        const result = await sendJson(`/api/admin/tenants?q=${encodeURIComponent(query)}`, "GET") as { tenants: typeof tenants };
        setTenants(result.tenants);
      }
      if (tab === "applications") {
        const result = await sendJson("/api/partnerships", "GET") as { applications: typeof applications };
        setApplications(result.applications);
      }
      if (tab === "reports") {
        const result = await sendJson("/api/reports", "GET") as { reports: typeof reports };
        setReports(result.reports);
      }
      if (tab === "identifier-requests") {
        const result = await sendJson("/api/admin/identifier-requests", "GET") as { requests: typeof identifierRequests };
        setIdentifierRequests(result.requests);
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : messagesFor(language).loadingGeneric); }
  }, [tab, query, language]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function updateTenant(tenantId: string, status: string, reason?: string) {
    try {
      await sendJson("/api/admin/tenants", "PATCH", { tenantId, status, reason });
      await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); }
  }
  async function decideApplication(id: string, decision: string) {
    try {
      await sendJson(`/api/partnerships/${id}`, "PATCH", { decision });
      await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.actionFailed); }
  }
  async function reviewReport(id: string, status: string) {
    try {
      await sendJson(`/api/reports/${id}`, "PATCH", { status, resolution: labels.reportReviewNote });
      await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.actionFailed); }
  }
  if (tab === "admins") return <section className="tool-section"><h2>{labels.admins}</h2><CreateAdmin /><label className="search-admin"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.searchPartner} /></label><Message value={message} onClose={() => setMessage("")} /><div className="admin-list">{tenants.map((tenant) => <article className="admin-card" key={tenant.id}><div className="admin-card-head"><strong>{tenant.displayName}</strong><span className={`status-pill status-${tenant.status.toLowerCase()}`}>{statusLabel(tenant.status)}</span></div><span>@{tenant.handle} · {tenant.owner.name} · {tenant.owner.email}</span><span>{labels.partnerCounts.replace("{members}", String(tenant._count.members)).replace("{posts}", String(tenant._count.posts)).replace("{reports}", String(tenant._count.reports)).replace("{status}", statusLabel(tenant.subscription?.status ?? "—"))}</span>{tenant.suspensionReason && <p>{tenant.suspensionReason}</p>}<div className="admin-actions">{tenant.status === "ACTIVE" ? <button className="button button-danger" onClick={() => { const reason = window.prompt(labels.suspendReason); if (reason) void updateTenant(tenant.id, "SUSPENDED", reason); }}>{labels.suspend}</button> : <button className="button button-dark" onClick={() => void updateTenant(tenant.id, "ACTIVE")}>{labels.reactivate}</button>}<Link href={`/${tenant.handle}`} target="_blank">{labels.publicProfile} <ExternalLink size={14} /></Link></div></article>)}</div></section>;
  if (tab === "applications") return <section className="tool-section"><h2>{labels.partnerRequests}</h2><Message value={message} onClose={() => setMessage("")} /><div className="admin-list">{applications.map((application) => <article className="admin-card" key={application.id}><strong>{application.requestedDisplayName} · @{application.requestedHandle}</strong><span>{application.user.name} · {application.user.email} · {statusLabel(application.status)}</span>{application.status === "PENDING" && <div className="admin-actions"><button className="button button-lime" onClick={() => void decideApplication(application.id, "APPROVED")}>{labels.approve}</button><button className="button button-danger" onClick={() => void decideApplication(application.id, "REJECTED")}>{labels.reject}</button></div>}</article>)}</div></section>;
  if (tab === "reports") return <section className="tool-section"><h2>{labels.reports}</h2><Message value={message} onClose={() => setMessage("")} /><div className="admin-list">{reports.map((report) => <article className="admin-card" key={report.id}><strong>@{report.tenant.handle} · {report.reason}</strong><span>{labels.reportedBy} {report.author.name} · {statusLabel(report.status)}</span><p>{report.description}</p>{["OPEN", "UNDER_REVIEW"].includes(report.status) && <div className="admin-actions"><button className="button button-dark" onClick={() => void reviewReport(report.id, "UNDER_REVIEW")}>{labels.underReview}</button><button className="button button-lime" onClick={() => void reviewReport(report.id, "RESOLVED")}>{labels.resolveReport}</button><button className="button button-danger" onClick={() => void reviewReport(report.id, "DISMISSED")}>{labels.dismissReport}</button></div>}</article>)}</div></section>;
  if (tab === "identifier-requests") return <section className="tool-section"><h2>{labels.identifierRequestsTitle}</h2><Message value={message} onClose={() => setMessage("")} /><div className="admin-list">{identifierRequests.map((item) => <article className="admin-card" key={item.id}><strong>{item.tenant.displayName} · @{item.oldHandle} → @{item.requestedHandle}</strong><span>{item.reason} · {statusLabel(item.status)}</span>{item.status === "OPEN" && <div className="admin-actions"><button className="button button-lime" onClick={async () => { try { await sendJson(`/api/admin/identifier-requests/${item.id}`, "PATCH", { decision: "RESOLVED" }); await refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); } }}>{labels.approveRequest}</button><button className="button button-danger" onClick={async () => { try { await sendJson(`/api/admin/identifier-requests/${item.id}`, "PATCH", { decision: "DISMISSED" }); await refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); } }}>{labels.rejectRequest}</button></div>}</article>)}</div></section>;
  if (tab === "settings") return <GlobalSettings />;
  return null;
}

function CreateAdmin() {
  const labels = messagesFor(useLanguage());
  const [activationUrl, setActivationUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage("");
    try {
      const result = await sendJson("/api/admin/tenants", "POST", Object.fromEntries(form.entries())) as { activationUrl: string };
      setActivationUrl(result.activationUrl);
      setMessage(labels.partnerCreatedNotice);
      formElement.reset();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); }
    finally { setBusy(false); }
  }
  return <details className="create-admin"><summary><Plus size={15} /> {labels.createPartnerManual}</summary><Message value={message} onClose={() => setMessage("")} /><form className="panel-form" onSubmit={submit}><div className="form-row"><label>{labels.fullName}<input className="text-field" name="name" required minLength={2} /></label><label>{labels.email}<input className="text-field" name="email" type="email" required /></label></div><div className="form-row"><label>{labels.phone}<input className="text-field" name="phone" placeholder="+229…" /></label><label>{labels.publicIdentifier}<input className="text-field" name="handle" required pattern="[a-zA-Z0-9-]+" /></label></div><label>{labels.publicName}<input className="text-field" name="displayName" required minLength={2} /></label><label>{labels.publicBiography}<textarea className="text-field text-area" name="bio" rows={3} /></label><button className="button button-lime" disabled={busy}>{busy ? labels.createPartnerLoading : labels.createPartner}</button></form>{activationUrl && <div className="activation-link"><span>{activationUrl}</span><button className="button button-dark button-small" onClick={() => void navigator.clipboard.writeText(activationUrl)}><Copy size={14} /> {labels.copyActivationLink}</button></div>}</details>;
}

function GlobalSettings() {
  const labels = messagesFor(useLanguage());
  const [initial, setInitial] = useState<{ monthlyPrice: number; currency: string; trialDays: number; support: Record<string, string>; contract: string } | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void sendJson("/api/admin/settings", "GET").then((result) => {
        const settings = result.settings as Record<string, unknown>;
        const support = (settings.support ?? {}) as Record<string, string>;
        const contract = (settings["partner-contract"] ?? {}) as { content?: string };
        const plan = result.plan as { monthlyPrice: number; currency: string; trialDays: number } | null;
        setInitial({
          monthlyPrice: plan?.monthlyPrice ?? 200,
          currency: plan?.currency ?? "XOF",
          trialDays: plan?.trialDays ?? 3,
          support,
          contract: contract.content ?? labels.defaultPartnerContract,
        });
      }).catch((cause) => setMessage(cause instanceof Error ? cause.message : labels.loadingGeneric));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [labels.loadingGeneric, labels.defaultPartnerContract]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await sendJson("/api/admin/settings", "PATCH", {
        monthlyPrice: Number(form.get("monthlyPrice")),
        currency: form.get("currency"),
        trialDays: Number(form.get("trialDays")),
        supportEmail: form.get("supportEmail"),
        supportPhone: form.get("supportPhone"),
        supportWhatsApp: form.get("supportWhatsApp"),
        supportTelegram: form.get("supportTelegram"),
        partnerContract: form.get("partnerContract"),
      });
      setMessage(labels.globalSettingsSaved);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); }
  }
  if (!initial) return <p className="panel-description">{labels.globalLoading}</p>;
  return <section className="tool-section"><h2>{labels.adminSettingsTitle}</h2><p className="panel-description">{labels.adminSettingsSecrets}</p><Message value={message} onClose={() => setMessage("")} /><form className="panel-form" onSubmit={submit}><h3>{labels.partnerSubscriptions}</h3><div className="form-row"><label>{labels.monthlyRate}<input className="text-field" name="monthlyPrice" type="number" min="0" defaultValue={initial.monthlyPrice} required /></label><label>{labels.currencyLabel}<input className="text-field" name="currency" defaultValue={initial.currency} pattern="[A-Z]{3}" required /></label></div><label>{labels.trialDaysLabel}<input className="text-field" name="trialDays" type="number" min="0" max="30" defaultValue={initial.trialDays} required /></label><h3>{labels.assistance}</h3><label>{labels.email}<input className="text-field" name="supportEmail" type="email" defaultValue={initial.support.supportEmail ?? ""} /></label><label>{labels.phone}<input className="text-field" name="supportPhone" defaultValue={initial.support.supportPhone ?? ""} /></label><label>WhatsApp<input className="text-field" name="supportWhatsApp" defaultValue={initial.support.supportWhatsApp ?? ""} /></label><label>Telegram<input className="text-field" name="supportTelegram" defaultValue={initial.support.supportTelegram ?? ""} /></label><h3>{labels.partnerContract}</h3><label>{labels.contractText}<textarea className="text-field text-area" name="partnerContract" rows={8} defaultValue={initial.contract} required minLength={20} /></label><button className="button button-lime">{labels.saveSettings}</button></form></section>;
}

function SettingsPanel() {
  const router = useRouter();
  const [user, setUser] = useState<{
    name: string;
    email: string | null;
    phone: string | null;
    country: string | null;
    avatarUrl: string | null;
    bio: string | null;
    role: string;
    settings: { language: string; theme: string; notifications: boolean } | null;
    ownedTenants: {
      handle: string;
      displayName: string;
      bio: string | null;
      paymentLink?: string | null;
      paymentPhone?: string | null;
      paymentInstructions?: string | null;
    }[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [handleMessage, setHandleMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [language, setLanguage] = useState("fr");
  const [theme, setTheme] = useState("dark");
  const [busy, setBusy] = useState(false);
  const labels = messagesFor(language);
  const countries = countryOptions(language);
  useEffect(() => {
    void sendJson("/api/settings", "GET").then((result) => {
      const profile = result.user as NonNullable<typeof user>;
      setUser(profile);
      const preferredLanguage = profile.settings?.language ?? document.documentElement.lang ?? "fr";
      const savedTheme = profile.settings?.theme ?? localStorage.getItem("webmondial.theme") ?? "dark";
      const preferredTheme = savedTheme === "light" ? "light" : "dark";
      setLanguage(preferredLanguage);
      setTheme(preferredTheme);
      if (document.documentElement.lang !== preferredLanguage) {
        applyPreferences(preferredTheme, preferredLanguage);
      }
    }).catch((cause) => setMessage(cause instanceof Error ? cause.message : "Chargement impossible."));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const profile = Object.fromEntries(form.entries());
      const avatarFile = profile.avatarFile;
      delete profile.avatarFile;
      let avatarUrl = String(profile.avatarUrl ?? "");
      if (avatarFile instanceof File && avatarFile.size > 0) {
        const uploaded = await uploadMediaFile(avatarFile, "avatar", labels.mediaUploadError);
        avatarUrl = uploaded.url;
      }
      profile.avatarUrl = avatarUrl;
      profile.notifications = form.get("notifications") === "on" ? "true" : "false";
      await sendJson("/api/settings", "PATCH", profile);
      applyPreferences(theme, language);
      setUser((current) => current ? {
        ...current,
        name: String(profile.name),
        email: String(profile.email) || null,
        phone: String(profile.phone) || null,
        country: String(profile.country) || null,
        avatarUrl: avatarUrl || null,
        bio: String(profile.bio ?? current.bio ?? ""),
        ownedTenants: current.ownedTenants.map((tenant, index) => index === 0 ? {
          ...tenant,
          displayName: String(profile.displayName ?? tenant.displayName),
          bio: String(profile.bio ?? tenant.bio ?? ""),
          paymentLink: String(profile.paymentLink ?? tenant.paymentLink ?? "") || null,
          paymentPhone: String(profile.paymentPhone ?? tenant.paymentPhone ?? "") || null,
          paymentInstructions: String(profile.paymentInstructions ?? tenant.paymentInstructions ?? "") || null,
        } : tenant),
        settings: {
          language,
          theme,
          notifications: profile.notifications === "true",
        },
      } : current);
      setMessage(messagesFor(language).saveSuccess);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await sendJson("/api/settings", "PUT", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword("");
      setMessage(labels.passwordChanged);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.passwordChangeFailed); }
  }
  async function requestHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await sendJson("/api/settings", "PATCH", { intent: "change-handle", requestedHandle: form.get("requestedHandle"), reason: form.get("reason") });
      setHandleMessage(labels.handleRequestSent);
      formElement.reset();
    } catch (cause) { setHandleMessage(cause instanceof Error ? cause.message : labels.sendFailed); }
  }
  if (!user) return <div className="loading-inline"><LoaderCircle className="spin" size={17} /> {labels.loadingSettings}</div>;
  return (
    <section className="tool-section">
      <h2>{labels.profile}</h2>
      <Message value={message} onClose={() => setMessage("")} />
      <form className="panel-form" onSubmit={save}>
        <label>{labels.fullName}<input className="text-field" name="name" defaultValue={user.name} required /></label>
        <label>{labels.email}<input className="text-field" name="email" type="email" defaultValue={user.email ?? ""} /></label>
        <label>{labels.phone}<input className="text-field" name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder={labels.phonePlaceholder} /></label>
        <label>{labels.country}<select className="text-field" name="country" defaultValue={countryCodeFromValue(user.country ?? "", language)}>
          <option value="">{labels.chooseCountry}</option>
          {countries.map(({ code, name, flag }) => <option value={code} key={code}>{flag} {name}</option>)}
        </select></label>
        <label>{labels.photo}{user.avatarUrl && <Image className="settings-avatar" src={user.avatarUrl} alt="" width={64} height={64} unoptimized />}<input className="text-field" type="file" name="avatarFile" accept="image/jpeg,image/png,image/gif,image/webp" /></label>
        <input type="hidden" name="avatarUrl" value={user.avatarUrl ?? ""} />
        {(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && user.ownedTenants[0] && <label>{labels.publicName}<input className="text-field" name="displayName" defaultValue={user.ownedTenants[0].displayName} minLength={2} maxLength={80} required /></label>}
        {(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && user.ownedTenants[0] && <label>{labels.publicBio}<textarea className="text-field text-area" name="bio" defaultValue={user.ownedTenants[0].bio ?? ""} maxLength={1000} /></label>}
        <label>{labels.language}<select className="text-field" name="language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="fr">Français</option><option value="en">English</option><option value="es">Español</option></select></label>
        <label>{labels.theme}<select className="text-field" name="theme" value={theme} onChange={(event) => { setTheme(event.target.value); applyPreferences(event.target.value, language); }}><option value="dark">{labels.dark}</option><option value="light">{labels.light}</option></select></label>
        {user.role === "ADMIN" && user.ownedTenants[0] && <>
          <h3>{labels.paymentMethodHeading}</h3>
          <label>{labels.paymentLinkLabel}<input className="text-field" name="paymentLink" type="url" placeholder="https://…" defaultValue={user.ownedTenants[0].paymentLink ?? ""} /></label>
          <label>{labels.paymentPhoneLabel}<input className="text-field" name="paymentPhone" type="tel" placeholder={labels.phonePlaceholder} defaultValue={user.ownedTenants[0].paymentPhone ?? ""} /></label>
          <label>{labels.paymentInstructionsLabel}<textarea className="text-field text-area" name="paymentInstructions" rows={3} maxLength={2000} defaultValue={user.ownedTenants[0].paymentInstructions ?? ""} /></label>
        </>}
        <label className="checkbox-label"><input type="checkbox" name="notifications" defaultChecked={user.settings?.notifications ?? true} /> {labels.notificationsEnabled}</label>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : labels.save}</button>
      </form>
      <form className="panel-form password-form" onSubmit={changePassword}>
        <h3>{labels.changePassword}</h3>
        <label>{labels.currentPassword}<PasswordInput className="text-field" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
        <label>{labels.newPassword}<PasswordInput className="text-field" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} autoComplete="new-password" required /><small>{labels.passwordRequirementsShort}</small></label>
        <button className="button button-dark" type="submit">{labels.changePassword}</button>
      </form>
      {user.ownedTenants[0] && (
        <form className="panel-form password-form" onSubmit={requestHandle}>
          <h3>{labels.changeHandle}</h3>
          <p className="panel-description">{labels.handleChangeDescription.replace("{handle}", user.ownedTenants[0].handle)}</p>
          <label>{labels.currentHandle}<input className="text-field" value={`@${user.ownedTenants[0].handle}`} readOnly /></label>
          <label>{labels.newHandle}<input className="text-field" name="requestedHandle" required pattern="[a-zA-Z0-9-]+" /></label>
          <label>{labels.reason}<textarea className="text-field text-area" name="reason" minLength={10} required rows={3} /></label>
          <Message value={handleMessage} onClose={() => setHandleMessage("")} />
          <button className="button button-dark" type="submit">{labels.requestHandle}</button>
        </form>
      )}
    </section>
  );
}

function NotificationPanel() {
  const language = useLanguage();
  const labels = messagesFor(language);
  const [items, setItems] = useState<Array<{ id: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string }>>([]);
  const [message, setMessage] = useState("");
  const locale = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "fr-FR";
  const refresh = useCallback(() => { void sendJson("/api/notifications", "GET").then((result) => setItems(result.notifications as typeof items)).catch((cause) => setMessage(cause instanceof Error ? cause.message : labels.loadingGeneric)); }, [labels.loadingGeneric]);
  useEffect(() => { refresh(); }, [refresh]);
  async function markRead(id: string) {
    try { await sendJson("/api/notifications", "PATCH", { id }); refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.saveGeneric); }
  }
  return <section className="tool-section"><h2>{labels.notificationsTitle}</h2><Message value={message} onClose={() => setMessage("")} /><div className="admin-list">{items.map((item) => <article className={`notification-card ${item.readAt ? "" : "unread"}`} key={item.id}><Bell size={16} /><div><strong>{item.title}</strong><p>{item.body}</p><small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small>{item.href && <Link href={item.href}>{labels.open} <ArrowRight size={13} /></Link>}</div>{!item.readAt && <button className="button button-dark button-small" onClick={() => void markRead(item.id)}>{labels.markAsRead}</button>}</article>)}</div>{items.length === 0 && <p className="panel-description">{labels.noNotifications}</p>}</section>;
}

function ReportForm({ tenantHandle }: { tenantHandle: string }) {
  const labels = messagesFor(useLanguage());
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await sendJson("/api/reports", "POST", { tenantHandle, reason: form.get("reason"), description: form.get("description") });
      setMessage(labels.reportSent);
      formElement.reset();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : labels.sendFailed); }
  }
  return <form className="panel-form report-form" onSubmit={submit}><h3>{labels.reportTitle}</h3><p className="panel-description">{labels.reportDescription}</p><label>{labels.reportReason}<input className="text-field" name="reason" required minLength={3} maxLength={120} /></label><label>{labels.reportDetails}<textarea className="text-field text-area" name="description" minLength={10} maxLength={5000} rows={4} required /></label><Message value={message} onClose={() => setMessage("")} /><button className="button button-dark"><Flag size={15} /> {labels.reportSubmit}</button></form>;
}

export default function DashboardTools({
  role,
  tab,
  tenantHandle = "",
  tenantName = "",
  subscription = null,
  canPublish = role === "SUPER_ADMIN",
  canPublishPaid = role === "SUPER_ADMIN",
}: {
  role: string;
  tab: string;
  tenantHandle?: string;
  tenantName?: string;
  canPublish?: boolean;
  canPublishPaid?: boolean;
  subscription?: {
    status: string;
    paidMonths: number;
    trialEndsAt?: Date | string | null;
    currentPeriodEnd?: Date | string;
    plan: { monthlyPrice: number; currency: string; trialDays: number };
  } | null;
}) {
  const labels = messagesFor(useLanguage());
  const [postRefreshToken, setPostRefreshToken] = useState(0);
  const publicationTabs = ["posts", "DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE"];
  const refreshPosts = () => setPostRefreshToken((current) => current + 1);
  if (tab === "agreement") return <Agreement tenantHandle={tenantHandle} />;
  if (tab === "partner" && role === "PLAYER") return <PartnerApplication />;
  if (tab === "profile") return <SettingsPanel />;
  if ((role === "ADMIN" || role === "SUPER_ADMIN") && tenantHandle && publicationTabs.includes(tab)) {
    const category = tab === "posts" ? undefined : tab;
    if (role === "ADMIN" && !canPublish) {
      return (
        <>
          <section className="dashboard-alert" role="status">
            <strong>{labels.reportExpiredNotice}</strong>
            <span>{labels.postsBlockedNotice}</span>
            <Link href="/dashboard?tab=subscription">{labels.plansRenewLink}</Link>
          </section>
          <Feed tenantHandle={tenantHandle} category={category} />
        </>
      );
    }
    return <><PostComposer tenantHandle={tenantHandle} initialCategory={category} canPublishPaid={canPublishPaid} onPublished={refreshPosts} /><Feed tenantHandle={tenantHandle} category={category} managePosts refreshToken={postRefreshToken} /></>;
  }
  if ((role === "ADMIN" || role === "SUPER_ADMIN") && tab === "bookmakers") return <BookmakerManager canManage />;
  if ((role === "ADMIN" || role === "SUPER_ADMIN") && tab === "results") {
    if (role === "ADMIN" && !canPublish) {
      return (
        <section className="dashboard-alert" role="status">
          <strong>{labels.reportExpiredNotice}</strong>
          <span>{labels.resultsBlockedNotice}</span>
          <Link href="/dashboard?tab=subscription">{labels.plansRenewLink}</Link>
        </section>
      );
    }
    return <ResultsManager tenantHandle={tenantHandle} />;
  }
  if (role === "SUPER_ADMIN" && ["overview", "admins", "applications", "reports", "identifier-requests", "notifications", "settings"].includes(tab)) {
    return <AdminTools tab={tab} />;
  }
  if (tab === "settings") return <SettingsPanel />;
  if (tab === "notifications") return <NotificationPanel />;
  if (role === "ADMIN" && tab === "subscription") return <SubscriptionPanel subscription={subscription} />;
  if (role === "ADMIN" && tab === "support") return <section className="tool-section"><h2>{labels.assistance}</h2><p className="panel-description">{labels.supportHelp}</p></section>;
  if (role === "PLAYER" && tab === "bookmakers") return <BookmakerManager canManage={false} />;
  if (role === "PLAYER" && tab === "partner") return <PartnerApplication />;
  if (role === "PLAYER" && tenantHandle && tab === "results") return <ResultsFeed tenantHandle={tenantHandle} />;
  if (role === "PLAYER" && tenantHandle) return <><Feed tenantHandle={tenantHandle} category={["DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE"].includes(tab) ? tab : undefined} />{tab === "feed" && <ReportForm tenantHandle={tenantHandle} />}</>;
  return <div className="empty-feed"><span className="empty-icon"><ShieldCheck size={20} /></span><h3>{labels.emptyDashboardTitle}</h3><p>{labels.emptyDashboardDescription}</p></div>;
}
