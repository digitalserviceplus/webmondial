import Link from "next/link";
import { Trophy } from "lucide-react";
import ForgotPasswordForm from "./forgot-password-form";
import LanguageSwitcher, { T } from "@/components/language-switcher";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><Trophy size={18} /></span>
        <span>web<span className="brand-accent">mondial</span></span>
      </Link>
      <LanguageSwitcher className="auth-language" />
      <section className="auth-card">
        <span className="section-kicker"><T id="recoverTitle" /></span>
        <h1><T id="forgotPassword" /></h1>
        <p className="auth-intro"><T id="recoverDescription" /></p>
        <ForgotPasswordForm />
        <p className="auth-switch"><Link href="/connexion"><T id="backHome" /></Link></p>
      </section>
      <Link className="auth-back" href="/"><T id="backHome" /></Link>
    </main>
  );
}
