"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle, RefreshCw, Trophy } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export default function PaymentReturnStatus({ paymentId, returnTo }: { paymentId: string; returnTo: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    if (!paymentId) {
      setError(labels.paymentCheckError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/verify`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { status?: PaymentStatus; error?: string };
      if (!response.ok) throw new Error(result.error ?? labels.paymentCheckError);
      if (!result.status) throw new Error(labels.paymentCheckError);
      setStatus(result.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.paymentCheckError);
    } finally {
      setBusy(false);
    }
  }, [paymentId, labels.paymentCheckError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void verify(), 0);
    return () => window.clearTimeout(timer);
  }, [verify]);

  const statusMessage = status === "SUCCEEDED"
    ? labels.paymentSuccess
    : status === "FAILED" || status === "CANCELLED"
      ? labels.paymentFailed
      : status === "PENDING"
        ? labels.paymentPending
        : labels.paymentChecking;

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <section className="auth-card">
        <span className="section-kicker">{labels.paymentReturnTitle}</span>
        <h1>{labels.paymentReturnTitle}</h1>
        <p className="auth-intro" role={error ? "alert" : "status"}>
          {error || statusMessage}
        </p>
        {busy && <LoaderCircle className="spin" size={20} aria-label={labels.paymentChecking} />}
        {(status === "PENDING" || error) && (
          <button className="button button-dark auth-submit" type="button" onClick={() => void verify()} disabled={busy}>
            <RefreshCw size={16} /> {labels.paymentCheckAgain}
          </button>
        )}
        <Link className="button button-primary auth-submit" href={returnTo}>{labels.paymentDashboard}</Link>
      </section>
    </main>
  );
}
