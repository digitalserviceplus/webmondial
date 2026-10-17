"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Heart } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export function PostActions({
  postId,
  href,
  initialLikes,
  initialLiked,
  allowLike = true,
}: {
  postId: string;
  href: string;
  initialLikes: number;
  initialLiked: boolean;
  allowLike?: boolean;
}) {
  const labels = messagesFor(useLanguage());
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(initialLiked);
  const [message, setMessage] = useState("");

  async function toggleLike() {
    try {
      const response = await fetch(`/api/posts/${postId}/like`, { method: liked ? "DELETE" : "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (response.status === 401) throw new Error(labels.likeLoginRequired);
        throw new Error(result.error ?? labels.likeError);
      }
      setLiked(!liked);
      setLikes((current) => current + (liked ? -1 : 1));
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : labels.likeError);
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(href.startsWith("/") ? `${window.location.origin}${href}` : href);
      setMessage(labels.shareSuccess);
    } catch {
      setMessage(labels.shareError);
    }
  }

  return <div className="post-footer">
    {allowLike && <button type="button" className={`like-button ${liked ? "liked" : ""}`} onClick={() => void toggleLike()} aria-label={liked ? labels.unlike : labels.like}>
      <Heart size={16} /> {likes}
    </button>}
    <button type="button" className="text-action" onClick={() => void share()}><Copy size={14} /> {labels.share}</button>
    {message && <span className="post-action-message" role="status">{message}{message === labels.likeLoginRequired && <> <Link href="/connexion">{labels.login}</Link></>}</span>}
  </div>;
}
