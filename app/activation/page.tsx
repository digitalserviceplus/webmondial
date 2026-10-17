import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import ActivationForm from "./form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

async function ActivationContent({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  if (!token) return <div className="auth-notice"><h2>Lien d’activation invalide</h2><p>Demandez un nouveau lien à l’administration de la plateforme.</p></div>;
  return <ActivationForm token={token} />;
}

export default function ActivationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <main className="auth-page"><Link className="brand auth-brand" href="/"><span className="brand-mark"><Trophy size={18} /></span><span>web<span className="brand-accent">mondial</span></span></Link><LanguageSwitcher className="auth-language" /><section className="auth-card"><span className="section-kicker"><T id="activationKicker" /></span><h1><T id="activationTitle" /></h1><p className="auth-intro"><T id="activationDescription" /></p><Suspense fallback={<p className="page-loading">Vérification du lien…</p>}><ActivationContent searchParams={searchParams} /></Suspense></section><Link className="auth-back" href="/"><T id="backHome" /></Link></main>;
}
