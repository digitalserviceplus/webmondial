import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import RegisterForm from "./register-form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

async function RegistrationContent({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; type?: string }>;
}) {
  const { tenant = "", type = "" } = await searchParams;
  if (type === "partner" && !tenant) return <RegisterForm tenantHandle="" partnerSignup />;
  if (!tenant) {
    return (
      <div className="auth-notice">
        <h2><T id="registerExistingSpace" /></h2>
        <p><T id="registerFindSpace" /></p>
        <Link className="button button-dark" href="/"><T id="registerFindButton" /></Link>
      </div>
    );
  }
  return <RegisterForm tenantHandle={tenant} />;
}

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; type?: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading">Chargement…</main>}>
      <RegistrationPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RegistrationPageContent({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; type?: string }>;
}) {
  const { type = "" } = await searchParams;
  const partnerSignup = type === "partner";
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card auth-card-wide">
        <span className="section-kicker"><T id={partnerSignup ? "registerPartnerKicker" : "registerPlayerKicker"} /></span>
        <h1><T id={partnerSignup ? "registerPartnerTitle" : "registerPlayerTitle"} /></h1>
        <p className="auth-intro"><T id={partnerSignup ? "registerPartnerDescription" : "registerPlayerDescription"} /></p>
        <RegistrationContent searchParams={searchParams} />
        <p className="auth-switch"><T id="alreadyRegistered" /> <Link href="/connexion"><T id="login" /></Link></p>
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
