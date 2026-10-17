import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import ResetPasswordForm from "./reset-password-form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading">Chargement…</main>}>
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card">
        <span className="section-kicker"><T id="resetTitle" /></span>
        <h1><T id="resetTitle" /></h1>
        <p className="auth-intro"><T id="resetDescription" /></p>
        {token.length >= 32 ? <ResetPasswordForm token={token} /> : <div className="auth-notice"><p>Le lien est absent ou invalide. Demandez-en un nouveau.</p><Link className="button button-primary" href="/mot-de-passe-oublie">Récupérer mon compte</Link></div>}
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
