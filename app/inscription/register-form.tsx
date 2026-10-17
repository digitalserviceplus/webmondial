"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import PasswordInput from "@/components/password-input";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";
import { countryOptions } from "@/lib/countries";
import {
  registrationSchema,
  type RegistrationInput,
  type RegistrationValues,
} from "@/lib/validation";

export default function RegisterForm({ tenantHandle, partnerSignup = false }: { tenantHandle: string; partnerSignup?: boolean }) {
  const router = useRouter();
  const language = useLanguage();
  const labels = messagesFor(language);
  const countries = countryOptions(language);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrationInput, unknown, RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { tenantHandle, country: "" },
  });

  async function onSubmit(values: RegistrationValues) {
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, language }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          setFormError(`${result.error ?? "Ce compte existe déjà."} `);
        } else {
          setFormError(result.error ?? "L’inscription a échoué.");
        }
        return;
      }

      const login = await signIn("credentials", {
        identifier: values.email || values.phone,
        password: values.password,
        redirect: false,
      });
      if (!login || login.error) {
        router.push("/connexion");
        return;
      }
      router.push(partnerSignup ? "/dashboard?tab=partner" : "/dashboard");
      router.refresh();
    } catch {
      setFormError("Impossible de joindre le serveur. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {tenantHandle && <input type="hidden" {...register("tenantHandle")} />}
      <label className="field-label" htmlFor="name">{labels.fullNameLabel}</label>
      <input className="text-field" id="name" autoComplete="name" placeholder={labels.namePlaceholder} {...register("name")} />
      {errors.name && <span className="field-error">{errors.name.message}</span>}
      <label className="field-label" htmlFor="email">{labels.email} <span className="field-optional">{labels.emailOrPhone}</span></label>
      <input className="text-field" id="email" type="email" autoComplete="email" placeholder={labels.emailPlaceholder} {...register("email")} />
      {errors.email && <span className="field-error">{errors.email.message}</span>}
      <label className="field-label" htmlFor="phone">{labels.phoneLabel} <span className="field-optional">{labels.phoneInternational}</span></label>
      <input className="text-field" id="phone" type="tel" autoComplete="tel" placeholder={labels.phonePlaceholder} {...register("phone")} />
      {errors.phone && <span className="field-error">{errors.phone.message}</span>}
      <label className="field-label" htmlFor="country">{labels.countryLabel}</label>
      <select className="text-field" id="country" autoComplete="country-name" defaultValue="" {...register("country")}>
        <option value="" disabled>{labels.chooseCountry}</option>
        {countries.map(({ code, name, flag }) => <option value={code} key={code}>{flag} {name}</option>)}
      </select>
      {errors.country && <span className="field-error">{errors.country.message}</span>}
      <label className="field-label" htmlFor="new-password">{labels.passwordLabel}</label>
      <PasswordInput className="text-field" id="new-password" autoComplete="new-password" placeholder={labels.passwordRequirements} {...register("password")} />
      <p className="form-legal">{labels.passwordRequirements}</p>
      {errors.password && <span className="field-error">{errors.password.message}</span>}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
          {formError.includes("existe déjà") && <Link href={partnerSignup ? "/connexion?partner=1" : `/connexion?tenant=${tenantHandle}`}>Connectez-vous</Link>}
        </p>
      )}
      <button className="button button-lime auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={17} /> : <>{labels.createAccount} <ArrowRight size={17} /></>}
      </button>
      <p className="form-legal">{partnerSignup ? labels.registerPartnerLegal : labels.registerPlayerLegal}</p>
    </form>
  );
}
