import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import LoginForm from "./login-form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; partner?: string; passwordReset?: string; notificationSent?: string; emailVerified?: string; returnTo?: string }>;
}) {
  const { tenant = "", partner, passwordReset, notificationSent, emailVerified, returnTo = "" } = await searchParams;
  const safeReturnTo = tenant && returnTo === `/${tenant}` ? returnTo : "";
  return <LoginForm tenantHandle={tenant} returnTo={safeReturnTo} partnerSignup={partner === "1"} passwordReset={passwordReset === "1"} passwordResetEmailFailed={passwordReset === "1" && notificationSent === "0"} emailVerified={emailVerified === "1"} />;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; partner?: string; passwordReset?: string; notificationSent?: string; emailVerified?: string; returnTo?: string }>;
}) {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card">
        <span className="section-kicker"><T id="loginKicker" /></span>
        <h1><T id="loginTitle" /></h1>
        <p className="auth-intro"><T id="loginDescription" /></p>
        <Suspense fallback={<p className="page-loading">Chargement…</p>}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
        <p className="auth-switch"><T id="noAccount" /> <Link href="/"><T id="findYourTipster" /></Link></p>
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
