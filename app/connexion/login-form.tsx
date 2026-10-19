"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { loginSchema, type LoginValues } from "@/lib/validation";
import PasswordInput from "@/components/password-input";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function LoginForm({ tenantHandle = "", returnTo = "", partnerSignup = false, passwordReset = false, passwordResetEmailFailed = false, emailVerified = false }: {
  tenantHandle?: string;
  returnTo?: string;
  partnerSignup?: boolean;
  passwordReset?: boolean;
  passwordResetEmailFailed?: boolean;
  emailVerified?: boolean;
}) {
  const language = useLanguage();
  const labels = messagesFor(language);
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setSubmitting(true);
    setFormError("");
    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });
      if (!result || result.error) {
        setFormError("Email ou mot de passe incorrect. Si vous venez de créer votre compte, vérifiez votre adresse email.");
        return;
      }
      if (tenantHandle) {
        const response = await fetch("/api/memberships", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantHandle }),
        });
        const membership = (await response.json()) as { error?: string };
        if (!response.ok) {
          setFormError(membership.error ?? "Impossible de rejoindre cet espace.");
          return;
        }
      }
      const preferenceResponse = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      if (!preferenceResponse.ok) {
        const preference = await preferenceResponse.json().catch(() => ({})) as { error?: string };
        setFormError(preference.error ?? "La langue de l’espace n’a pas pu être enregistrée.");
      }
      router.push(returnTo || (partnerSignup ? "/dashboard?tab=partner" : "/dashboard"));
      router.refresh();
    } catch {
      setFormError("La connexion a échoué. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {passwordReset && <p className="dashboard-message" role="status">{labels.passwordResetSuccess ?? "Votre mot de passe a été réinitialisé. Vous pouvez vous connecter."}</p>}
      {passwordResetEmailFailed && <p className="form-error" role="alert">{labels.passwordResetEmailFailed}</p>}
      {emailVerified && <p className="dashboard-message" role="status">{labels.emailVerifiedSuccess}</p>}
      <label className="field-label" htmlFor="email">{labels.email}</label>
      <input className="text-field" id="email" type="email" autoComplete="email" placeholder="vous@exemple.com" {...register("email")} />
      {errors.email && <span className="field-error">{errors.email.message}</span>}
      <label className="field-label" htmlFor="password">{labels.password}</label>
      <PasswordInput className="text-field" id="password" autoComplete="current-password" {...register("password")} />
      {errors.password && <span className="field-error">{errors.password.message}</span>}
      <Link className="forgot-password-link" href="/mot-de-passe-oublie">{labels.forgotPassword}</Link>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="button button-lime auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={17} /> : <>{labels.signIn} <ArrowRight size={17} /></>}
      </button>
    </form>
  );
}
