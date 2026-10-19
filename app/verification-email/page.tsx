import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import LanguageSwitcher, { T } from "@/components/language-switcher";
import VerificationForm from "./verification-form";

export default function VerificationEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; deliveryError?: string; partner?: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading">Chargement…</main>}>
      <VerificationEmailContent searchParams={searchParams} />
    </Suspense>
  );
}

async function VerificationEmailContent({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; deliveryError?: string; partner?: string }>;
}) {
  const { sent, deliveryError, partner } = await searchParams;
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card">
        <span className="section-kicker"><T id="verifyEmailKicker" /></span>
        <h1><T id="verifyEmailTitle" /></h1>
        <p className="auth-intro"><T id="verifyEmailDescription" /></p>
        <VerificationForm sent={sent === "1"} deliveryError={deliveryError === "1"} partnerSignup={partner === "1"} />
        <p className="auth-switch"><Link href="/connexion"><T id="login" /></Link></p>
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
