"use client";

import { BriefcaseBusiness, Copy, ExternalLink, Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function CommunityShare({ url, title }: { url: string; title: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const [message, setMessage] = useState("");
  const shareUrl = url;

  async function nativeShare() {
    const absoluteUrl = new URL(shareUrl, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url: absoluteUrl });
      } catch (cause) {
        if (cause instanceof Error && cause.name !== "AbortError") setMessage(labels.shareError);
      }
      return;
    }
    setMessage(labels.shareMore);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(shareUrl, window.location.origin).toString());
      setMessage(labels.shareSuccess);
    } catch {
      setMessage(labels.shareError);
    }
  }

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  const shareText = `${title} ${shareUrl}`;

  return (
    <div className="community-share">
      <button className="button button-dark button-small" type="button" onClick={() => void nativeShare()}>
        <Share2 size={15} /> {labels.share}
      </button>
      <a
        className="community-share-link community-share-whatsapp"
        href={`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={labels.shareWhatsApp}
      >
        <MessageCircle size={16} /> <span>WhatsApp</span>
      </a>
      <details className="community-share-more">
        <summary className="community-share-link">{labels.shareMoreOptions}</summary>
        <div className="community-share-options">
          <a
            className="community-share-link community-share-facebook"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.shareFacebook}
          >
            <ExternalLink size={16} /> <span>Facebook</span>
          </a>
          <a
            className="community-share-link community-share-x"
            href={`https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.shareX}
          >
            <ExternalLink size={16} /> <span>X</span>
          </a>
          <a
            className="community-share-link"
            href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.shareTelegram}
          >
            <Send size={16} /> <span>Telegram</span>
          </a>
          <a
            className="community-share-link"
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.shareLinkedIn}
          >
            <BriefcaseBusiness size={16} /> <span>LinkedIn</span>
          </a>
          <a
            className="community-share-link"
            href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.shareReddit}
          >
            <ExternalLink size={16} /> <span>Reddit</span>
          </a>
          <a
            className="community-share-link"
            href={`https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedTitle}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.sharePinterest}
          >
            <ExternalLink size={16} /> <span>Pinterest</span>
          </a>
          <a
            className="community-share-link"
            href={`mailto:?subject=${encodedTitle}&body=${encodeURIComponent(shareText)}`}
            aria-label={labels.shareEmail}
          >
            <Mail size={16} /> <span>{labels.shareEmail}</span>
          </a>
          <a
            className="community-share-link"
            href={`sms:?body=${encodeURIComponent(shareText)}`}
            aria-label={labels.shareSMS}
          >
            <MessageCircle size={16} /> <span>SMS</span>
          </a>
        </div>
      </details>
      <button className="community-share-link" type="button" onClick={() => void copyLink()}>
        <Copy size={15} /> <span>{labels.copyLink}</span>
      </button>
      {message && <span className="community-share-message" role="status">{message}</span>}
    </div>
  );
}
