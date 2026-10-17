import { Suspense } from "react";
import Link from "next/link";
import { io } from "next/cache";
import { Trophy } from "lucide-react";
import { prisma } from "@/lib/prisma";
import SetupForm from "./setup-form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

async function SetupStatus() {
  await io();
  const [setupState, existingAdmin] = await Promise.all([
    prisma.setupState.findUnique({ where: { key: "initial-super-admin" }, select: { key: true } }),
    prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } }),
  ]);

  if (setupState || existingAdmin) {
    return (
      <div className="auth-notice">
        <h2>La configuration est terminée.</h2>
        <p>Un admin général existe déjà. La création initiale est verrouillée.</p>
        <Link className="button button-dark" href="/connexion">Aller à la connexion</Link>
      </div>
    );
  }
  if (!process.env.INITIAL_SETUP_TOKEN) {
    return (
      <div className="auth-notice">
        <h2>Configuration requise</h2>
        <p>Définissez INITIAL_SETUP_TOKEN dans votre environnement serveur, puis redémarrez l’application.</p>
      </div>
    );
  }
  return <SetupForm setupToken={process.env.NODE_ENV === "development" ? process.env.INITIAL_SETUP_TOKEN : undefined} />;
}

export default function SetupPage() {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card">
        <span className="section-kicker"><T id="setupKicker" /></span>
        <h1><T id="setupTitle" /></h1>
        <p className="auth-intro"><T id="setupDescription" /></p>
        <Suspense fallback={<p className="page-loading">Vérification de la configuration…</p>}>
          <SetupStatus />
        </Suspense>
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
