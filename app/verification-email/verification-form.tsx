"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function VerificationForm({
  sent = false,
  deliveryError = false,
  partnerSignup = false,
}: {
  sent?: boolean;
  deliveryError?: boolean;
  partnerSignup?: boolean;
}) {
  const labels = messagesFor(useLanguage());
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsRemaining, setSecondsRemaining] = useState(sent ? 60 : 0);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const emailInput = emailRef.current;
    if (emailInput) emailInput.value = sessionStorage.getItem("webmondial.pendingVerificationEmail") ?? "";
  }, []);

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = window.setTimeout(() => setSecondsRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsRemaining]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const email = emailRef.current?.value.trim() ?? "";
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? labels.verificationFailed);
        return;
      }
      sessionStorage.removeItem("webmondial.pendingVerificationEmail");
      router.replace(`/connexion?emailVerified=1${partnerSignup ? "&partner=1" : ""}`);
    } catch {
      setError(labels.serverUnavailable);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    const email = emailRef.current?.value.trim() ?? "";
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        setError(result.error ?? labels.verificationFailed);
        return;
      }
      setSecondsRemaining(60);
      setNotice(result.message ?? labels.resendGeneric);
    } catch {
      setError(labels.serverUnavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={verify}>
      {sent && <p className="dashboard-message" role="status">{labels.verificationCodeSent}</p>}
      {deliveryError && <p className="form-error" role="alert">{labels.verificationDeliveryError}</p>}
      <label className="field-label" htmlFor="email">{labels.email}</label>
      <input
        className="text-field"
        id="email"
        ref={emailRef}
        type="email"
        autoComplete="email"
        required
      />
      <label className="field-label" htmlFor="verification-code">{labels.verificationCodeLabel}</label>
      <input
        className="text-field"
        id="verification-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{8}"
        maxLength={8}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="dashboard-message" role="status">{notice}</p>}
      <button className="button button-lime auth-submit" type="submit" disabled={busy || code.length !== 8}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <>{labels.verifyEmail} <ArrowRight size={17} /></>}
      </button>
      <button className="button button-dark auth-submit" type="button" disabled={busy || secondsRemaining > 0} onClick={resend}>
        {secondsRemaining > 0 ? `${labels.resendCode} (${secondsRemaining}s)` : labels.resendCode}
      </button>
    </form>
  );
}
