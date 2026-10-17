"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import PasswordInput from "@/components/password-input";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function ResetPasswordForm({ token }: { token: string }) {
  const labels = messagesFor(useLanguage());
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const password = new FormData(event.currentTarget).get("password");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Impossible de modifier le mot de passe.");
      router.replace("/connexion?passwordReset=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de joindre le serveur.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="new-password">{labels.passwordLabel}</label>
      <PasswordInput className="text-field" id="new-password" name="password" minLength={12} maxLength={128} autoComplete="new-password" required />
      <p className="form-legal">{labels.passwordRequirements}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <>{labels.resetSubmit} <ArrowRight size={16} /></>}
      </button>
      <p className="auth-switch"><Link href="/connexion">Retour à la connexion</Link></p>
    </form>
  );
}
