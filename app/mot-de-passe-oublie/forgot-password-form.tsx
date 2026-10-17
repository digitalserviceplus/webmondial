"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function ForgotPasswordForm() {
  const labels = messagesFor(useLanguage());
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setResetUrl("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { error?: string; message?: string; resetUrl?: string };
      if (!response.ok) throw new Error(result.error ?? "La demande de récupération a échoué.");
      setMessage(result.message ?? "Consultez votre email pour continuer.");
      if (result.resetUrl) setResetUrl(result.resetUrl);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Impossible de joindre le serveur.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="email">{labels.recoverEmail}</label>
      <input className="text-field" id="email" name="email" type="email" autoComplete="email" required />
      {message && <p className="dashboard-message" role="status">{message}</p>}
      {resetUrl && <Link className="button button-primary" href={resetUrl}>{labels.recoverLinkButton} <ArrowRight size={16} /></Link>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <>{labels.recoverSend} <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}
