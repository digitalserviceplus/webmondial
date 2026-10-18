import Link from "next/link";
import { ArrowRight, BarChart3, CircleDollarSign, ShieldCheck, Trophy } from "lucide-react";
import LanguageSwitcher, { T } from "@/components/language-switcher";
import TenantSearch from "@/app/tenant-search";
import GlobeIllustration from "@/app/globe-illustration";

const benefits = [
  {
    icon: ShieldCheck,
    titleKey: "benefitSpace",
    textKey: "benefitSpaceText",
  },
  {
    icon: BarChart3,
    titleKey: "benefitPosts",
    textKey: "benefitPostsText",
  },
  {
    icon: CircleDollarSign,
    titleKey: "benefitSecure",
    textKey: "benefitSecureText",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Web Mondial, accueil">
          <span className="brand-mark"><Trophy size={18} strokeWidth={2.4} /></span>
          <span>web<span className="brand-accent">mondial</span></span>
        </Link>
        <nav className="header-nav" aria-label="Navigation principale">
          <Link href="#fonctionnement"><T id="homeDiscover" /></Link>
          <Link className="button button-small button-primary header-login" href="/connexion"><T id="login" /></Link>
          <LanguageSwitcher />
          <Link className="button button-small button-primary" href="/inscription?type=partner">
            <T id="becomePartner" /> <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> <T id="homeKicker" /></div>
          <h1><T id="homeTitleFirst" /><br /><span><T id="homeTitleSecond" /></span></h1>
          <p className="hero-description">
            <T id="homeDescription" />
          </p>
          <TenantSearch />
          <p className="search-hint"><T id="searchHint" /></p>
        </div>
        <GlobeIllustration />
      </section>

      <section className="search-band" aria-label="Recherche de pronostiqueur">
        <div className="search-band-copy">
          <span className="section-kicker"><T id="nextStep" /></span>
          <h2><T id="followTipster" /></h2>
          <p><T id="findSpace" /></p>
        </div>
        <div className="search-band-action">
          <Link className="button button-lime" href="#recherche"><T id="findTipster" /> <ArrowRight size={17} /></Link>
          <span><T id="quickSignup" /></span>
        </div>
      </section>

      <section className="benefits-section" id="fonctionnement">
        <div className="section-heading">
          <span className="section-kicker"><T id="platformTitle" /></span>
          <h2><T id="platformSubtitle" /></h2>
        </div>
        <div className="benefit-grid">
          {benefits.map(({ icon: Icon, titleKey, textKey }, index) => (
            <article className="benefit-card" key={titleKey}>
              <span className="benefit-icon"><Icon size={20} /></span>
              <span className="benefit-index">0{index + 1}</span>
              <h3><T id={titleKey} /></h3>
              <p><T id={textKey} /></p>
            </article>
          ))}
        </div>
      </section>

      <section className="partner-banner" id="programme">
        <div>
          <span className="section-kicker"><T id="partnerKicker" /></span>
          <h2><T id="partnerHeadline" /></h2>
          <p><T id="partnerDescription" /></p>
        </div>
        <Link className="button button-primary" href="/inscription?type=partner"><T id="becomePartner" /> <ArrowRight size={16} /></Link>
      </section>

      <footer className="site-footer">
        <Link className="brand brand-footer" href="/">
          <span className="brand-mark"><Trophy size={16} /></span>
          <span>web<span className="brand-accent">mondial</span></span>
        </Link>
        <span><T id="footerMotto" /></span>
        <Link href="/inscription?type=partner"><T id="becomePartner" /></Link>
        <small className="footer-copyright"><T id="allRightsReserved" /></small>
      </footer>
    </main>
  );
}
