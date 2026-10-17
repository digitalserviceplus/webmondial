"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import PasswordInput from "@/components/password-input";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function ActivationForm({ token }: { token: string }) {
  const labels = messagesFor(useLanguage());
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: form.get("password") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "L’activation a échoué.");
        return;
      }
      router.push("/connexion");
    } catch {
      setError("Impossible de joindre le serveur. Réessayez.");
    } finally {
      setBusy(false);
    }
  }
  return <form className="auth-form" onSubmit={submit}><label className="field-label" htmlFor="password">{labels.passwordLabel}</label><PasswordInput className="text-field" id="password" name="password" required minLength={12} autoComplete="new-password" /><p className="form-legal">{labels.passwordRequirements}</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <>Activer mon compte <ArrowRight size={16} /></>}</button><p className="auth-switch"><Link href="/connexion">{labels.login}</Link></p></form>;
}
