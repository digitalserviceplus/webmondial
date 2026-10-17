"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import PasswordInput from "@/components/password-input";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";
import {
  initialAdminSchema,
  type InitialAdminInput,
  type InitialAdminValues,
} from "@/lib/validation";

export default function SetupForm({ setupToken }: { setupToken?: string }) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InitialAdminInput, unknown, InitialAdminValues>({
    resolver: zodResolver(initialAdminSchema),
  });

  async function onSubmit(values: InitialAdminValues) {
    setSubmitting(true);
    setFormError("");
    try {
      const payload = { ...values, language, setupToken: setupToken ?? values.setupToken };
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFormError(result.error ?? "La configuration a échoué.");
        return;
      }
      router.push("/connexion");
      router.refresh();
    } catch {
      setFormError("Impossible de joindre le serveur. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {setupToken && <input type="hidden" value={setupToken} {...register("setupToken")} />}
      <label className="field-label" htmlFor="name">{labels.setupName}</label>
      <input className="text-field" id="name" autoComplete="name" {...register("name")} />
      {errors.name && <span className="field-error">{errors.name.message}</span>}
      <label className="field-label" htmlFor="email">{labels.email}</label>
      <input className="text-field" id="email" type="email" autoComplete="email" {...register("email")} />
      {errors.email && <span className="field-error">{errors.email.message}</span>}
      <label className="field-label" htmlFor="phone">{labels.phoneLabel} <span className="field-optional">{labels.phoneInternational}</span></label>
      <input className="text-field" id="phone" type="tel" autoComplete="tel" placeholder="+229XXXXXXXX" {...register("phone")} />
      {errors.phone && <span className="field-error">{errors.phone.message}</span>}
      <label className="field-label" htmlFor="password">{labels.passwordLabel}</label>
      <PasswordInput className="text-field" id="password" autoComplete="new-password" placeholder={labels.passwordRequirements} {...register("password")} />
      <p className="form-legal">{labels.passwordRequirements}</p>
      {errors.password && <span className="field-error">{errors.password.message}</span>}
      {!setupToken && (
        <>
          <label className="field-label" htmlFor="setupToken">{labels.setupCode}</label>
          <input className="text-field" id="setupToken" type="password" autoComplete="off" {...register("setupToken")} />
          {errors.setupToken && <span className="field-error">{errors.setupToken.message}</span>}
        </>
      )}
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="button button-lime auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={17} /> : <>{labels.setupCreate} <ArrowRight size={17} /></>}
      </button>
    </form>
  );
}
