import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { io } from "next/cache";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CircleUserRound,
  Flag,
  LogOut,
  Megaphone,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { signOut, auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureGeneralAdminTenant } from "@/lib/admin-general-tenant";
import LanguageSwitcher, { T } from "@/components/language-switcher";
import DashboardTools from "./tools";
import DashboardNavigation from "./dashboard-navigation";
import { messagesFor } from "@/lib/i18n";
import { annualSubscriptionCutoff, canPublishContent, canPublishPaidContent } from "@/lib/subscriptions";
import { hasBeenOnPlatformForMoreThanThreeMonths } from "@/lib/report-eligibility";

const playerNavigation = [
  { id: "feed", label: "Accueil", icon: BookOpen },
  { id: "DAILY", label: "Coupons du jour", icon: BarChart3 },
  { id: "PREMIUM", label: "Coupons Premium", icon: ShieldCheck },
  { id: "MONTANTE", label: "Montante", icon: BarChart3 },
  { id: "VIP", label: "VIP", icon: ShieldCheck },
  { id: "FIXED", label: "Fixed", icon: BarChart3 },
  { id: "GROSSE_COTE", label: "Grosse cote", icon: BarChart3 },
  { id: "results", label: "Résultats des coupons", icon: Trophy },
  { id: "bookmakers", label: "Bookmakers", icon: Building2 },
  { id: "partner", label: "Devenir partenaire", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Paramètres", icon: Settings2 },
];
const adminNavigation = [
  { id: "overview", label: "Vue d’ensemble", icon: BarChart3 },
  { id: "posts", label: "Publications", icon: Megaphone },
  { id: "DAILY", label: "Coupons du jour", icon: BookOpen },
  { id: "PREMIUM", label: "Coupons Premium", icon: ShieldCheck },
  { id: "MONTANTE", label: "Montante", icon: BarChart3 },
  { id: "VIP", label: "VIP", icon: ShieldCheck },
  { id: "FIXED", label: "Fixed", icon: BarChart3 },
  { id: "GROSSE_COTE", label: "Grosse cote", icon: BarChart3 },
  { id: "results", label: "Résultats des coupons", icon: Trophy },
  { id: "bookmakers", label: "Bookmakers", icon: Building2 },
  { id: "subscription", label: "Abonnement", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "support", label: "Assistance", icon: Bell },
  { id: "settings", label: "Paramètres", icon: Settings2 },
];
const superAdminNavigation = [
  { id: "overview", label: "Vue d’ensemble", icon: BarChart3 },
  { id: "admins", label: "Gérer les partenaires", icon: Users },
  { id: "applications", label: "Demandes partenaires", icon: Building2 },
  { id: "reports", label: "Signalements", icon: Flag },
  { id: "identifier-requests", label: "Demandes d’identifiant", icon: Settings2 },
  ...adminNavigation.filter(({ id }) => ["posts", "DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE", "bookmakers", "results", "notifications", "support"].includes(id)),
  { id: "settings", label: "Paramètres", icon: Settings2 },
  { id: "profile", label: "Profil et préférences", icon: CircleUserRound },
];

async function DashboardContent({ tab }: { tab: string }) {
  await io();
  const session = await auth();
  if (!session?.user) redirect("/connexion");
  if (session.user.role === "SUPER_ADMIN") await ensureGeneralAdminTenant(session.user.id);

  const [memberships, ownedTenant, adminCount, playerCount, postCount, reportsCount, notificationCount, preferences, profile, annualPayment] =
    await Promise.all([
      session.user.role === "PLAYER"
        ? prisma.tenantMembership.findMany({
            where: { userId: session.user.id, tenant: { status: "ACTIVE" } },
            select: { tenant: { select: { handle: true, displayName: true, bio: true } } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      session.user.role !== "PLAYER"
        ? prisma.tenant.findFirst({
            where: { ownerId: session.user.id },
            select: {
              id: true,
              handle: true,
              displayName: true,
              status: true,
              suspensionReason: true,
              _count: { select: { members: true, posts: true } },
              subscription: {
                select: {
                  status: true,
                  currentPeriodEnd: true,
                  trialEndsAt: true,
                  paidMonths: true,
                  plan: { select: { monthlyPrice: true, currency: true, trialDays: true } },
                },
              },
              agreements: { select: { content: true, version: true, acceptedAt: true }, take: 1 },
            },
          })
        : null,
      session.user.role === "SUPER_ADMIN" ? prisma.user.count({ where: { role: "ADMIN" } }) : null,
      session.user.role === "SUPER_ADMIN" ? prisma.user.count({ where: { role: "PLAYER" } }) : null,
      session.user.role === "SUPER_ADMIN" ? prisma.post.count({ where: { status: "ACTIVE" } }) : null,
      session.user.role === "SUPER_ADMIN" ? prisma.report.count({ where: { status: "OPEN" } }) : null,
      prisma.notification.count({
        where: {
          userId: session.user.id,
          readAt: null,
          ...(session.user.role === "ADMIN" ? { tenant: { ownerId: session.user.id } } : {}),
        },
      }),
      prisma.userSettings.findUnique({
        where: { userId: session.user.id },
        select: { language: true, theme: true },
      }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, avatarUrl: true, createdAt: true },
      }),
      session.user.role === "ADMIN"
        ? prisma.payment.findFirst({
            where: {
              tenant: { ownerId: session.user.id },
              type: "PARTNER_SUBSCRIPTION",
              status: "SUCCEEDED",
              months: { gte: 12 },
              processedAt: { gte: annualSubscriptionCutoff() },
            },
            orderBy: { processedAt: "desc" },
            select: { processedAt: true },
          })
        : Promise.resolve(null),
    ]);

  const role = session.user.role;
  const serverNow = new Date();
  const labels = messagesFor(preferences?.language ?? "fr");
  const canPublishPaid = role === "SUPER_ADMIN" || canPublishPaidContent(
    ownedTenant?.subscription ?? null,
    annualPayment?.processedAt ?? null,
    serverNow,
  );
  const canReportAdmin = role === "PLAYER"
    && profile?.createdAt !== undefined
    && hasBeenOnPlatformForMoreThanThreeMonths(profile.createdAt, serverNow);
  const canPublish = role === "SUPER_ADMIN" || canPublishContent(ownedTenant?.subscription ?? null, serverNow);
  const rawNavigation = role === "SUPER_ADMIN" ? superAdminNavigation : role === "ADMIN" ? adminNavigation : playerNavigation;
  const labelForId: Record<string, string> = {
    feed: labels.homeTab,
    overview: labels.overview,
    posts: labels.posts,
    DAILY: labels.daily,
    PREMIUM: labels.premium,
    MONTANTE: labels.montante,
    VIP: labels.vip,
    FIXED: labels.fixed,
    GROSSE_COTE: labels.grosseCote,
    bookmakers: labels.bookmakers,
    results: labels.results,
    subscription: labels.subscription,
    notifications: labels.notifications,
    support: labels.support,
    settings: labels.settings,
    profile: labels.profile,
    partner: labels.partner,
    admins: labels.admins,
    applications: labels.applications,
    reports: labels.reports,
    "identifier-requests": labels.identifiers,
    "partner-posts": labels.posts,
    "partner-bookmakers": labels.bookmakers,
    "partner-subscription": labels.subscription,
    "global-settings": labels.settings,
  };
  const navigation = rawNavigation.map((item) => ({ ...item, label: labelForId[item.id] ?? item.label }));
  const currentTab = role === "ADMIN" && tab === "feed"
    ? "posts"
    : navigation.some((item) => item.id === tab) ? tab : role === "PLAYER" ? "feed" : "overview";
  const userName = profile?.name ?? session.user.name ?? "Web Mondial";
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const sidebarName = ownedTenant?.displayName ?? userName;
  const partnerSectionTabs = new Set(["posts", "DAILY", "PREMIUM", "MONTANTE", "VIP", "FIXED", "GROSSE_COTE", "results", "bookmakers"]);

  return (
    <main className="dashboard-shell">
      <header className="site-header dashboard-header">
        <Link className="brand" href="/">
          <span className="brand-mark"><Trophy size={18} /></span>
          <span>web<span className="brand-accent">mondial</span></span>
        </Link>
        <div className="dashboard-user">
          <span className="dashboard-user-name">{sidebarName}</span>
          <LanguageSwitcher />
          {profile?.avatarUrl
            ? <Image className="dashboard-avatar" src={profile.avatarUrl} alt="" width={38} height={38} unoptimized />
            : <span className="dashboard-avatar dashboard-avatar-initials">{initials}</span>}
          <form action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}>
            <button className="icon-button" type="submit" aria-label={labels.logout}><LogOut size={18} /></button>
          </form>
        </div>
      </header>
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label={labels.workspaceNavigation}>
          <div className="sidebar-user-card">
            {profile?.avatarUrl
              ? <Image className="sidebar-avatar" src={profile.avatarUrl} alt="" width={44} height={44} unoptimized />
              : <span className="sidebar-avatar sidebar-avatar-initials">{initials}</span>}
            <span className="sidebar-user-copy"><strong>{sidebarName}</strong>{(ownedTenant || role === "SUPER_ADMIN") && <small>{ownedTenant ? `@${ownedTenant.handle}` : labels.superAdminRole}</small>}</span>
            <span className={`sidebar-status-dot ${ownedTenant?.status === "SUSPENDED" ? "suspended" : ""}`} />
          </div>
          <DashboardNavigation
            caption={labels.menu}
            currentLabel={navigation.find((item) => item.id === currentTab)?.label ?? labels.menu}
          >
            {navigation.map(({ id, label, icon: Icon }) => (
              <Link className={`sidebar-link ${currentTab === id ? "active" : ""} ${partnerSectionTabs.has(id) ? "partner-nav-link" : ""}`} href={`/dashboard?tab=${id}`} key={id} aria-current={currentTab === id ? "page" : undefined}>
                <Icon size={17} />
                <span>{label}</span>
                {id === "notifications" && notificationCount > 0 && <span className="nav-count">{notificationCount}</span>}
              </Link>
            ))}
          </DashboardNavigation>
          {role === "SUPER_ADMIN" && <div className="sidebar-role"><ShieldCheck size={15} /> {labels.superAdminRole}</div>}
          {ownedTenant && <Link className="sidebar-public-link" href={`/${ownedTenant.handle}`} target="_blank">{labels.publicProfile} <ArrowRight size={14} /></Link>}
        </aside>
        <section className="dashboard-main">
          <div className="dashboard-heading">
            <div>
              <span className="section-kicker">{role === "SUPER_ADMIN" ? labels.generalAdmin : ownedTenant ? `@${ownedTenant.handle}` : labels.dashboardSpaceFallback}</span>
              <h1>{currentTab === "feed" ? `${labels.greeting}, ${userName.split(" ")[0]}.` : navigation.find((item) => item.id === currentTab)?.label}</h1>
              {role !== "PLAYER" && <p>{labels.adminSubtitle}</p>}
            </div>
            {role !== "PLAYER" && <span className="role-pill"><CircleUserRound size={15} /> {role === "SUPER_ADMIN" ? labels.superAdminRole : labels.partnerRole}</span>}
          </div>

          {ownedTenant?.status === "SUSPENDED" && (
            <div className="dashboard-alert" role="status">
              <strong>{labels.suspendedAccount}</strong>
              <span>{ownedTenant.suspensionReason || labels.suspendedContact}</span>
            </div>
          )}
          {ownedTenant?.status === "PENDING" && ownedTenant.agreements[0] && !ownedTenant.agreements[0].acceptedAt && (
            <div className="agreement-card">
              <span className="section-kicker">{labels.partnerRequestAccepted}</span>
              <h2>{labels.partnerAgreement}</h2>
              <p className="agreement-content">{ownedTenant.agreements[0].content}</p>
              <DashboardTools role={role} tab="agreement" tenantHandle={ownedTenant.handle} />
            </div>
          )}

          {role === "SUPER_ADMIN" && currentTab === "overview" && (
            <div className="dashboard-stats">
              <article><span>{labels.partners}</span><strong>{adminCount}</strong><Users size={18} /></article>
              <article><span>{labels.players}</span><strong>{playerCount}</strong><CircleUserRound size={18} /></article>
              <article><span>{labels.activePosts}</span><strong>{postCount}</strong><Megaphone size={18} /></article>
              <article><span>{labels.openReports}</span><strong>{reportsCount}</strong><Flag size={18} /></article>
            </div>
          )}

          {ownedTenant && role !== "PLAYER" && currentTab === "overview" && (
            <>
              {ownedTenant.subscription && new Date(ownedTenant.subscription.currentPeriodEnd).getTime() - serverNow.getTime() < 7 * 86400_000 && new Date(ownedTenant.subscription.currentPeriodEnd) > serverNow && (
                <div className="expiration-banner">{labels.subscriptionExpiringSoon} <Link href="/dashboard?tab=subscription">{labels.renewNow}</Link></div>
              )}
              {ownedTenant.subscription && (
                (ownedTenant.subscription.status === "EXPIRED" || ownedTenant.subscription.currentPeriodEnd <= serverNow) && (
                  <div className="dashboard-alert"><strong>{labels.trialOrSubscriptionExpired}</strong><Link href="/dashboard?tab=subscription">{labels.renewSubscription}</Link></div>
                )
              )}
              <div className="dashboard-stats">
                <article><span>{labels.players}</span><strong>{ownedTenant._count.members}</strong><Users size={18} /></article>
                <article><span>{labels.publicationCount}</span><strong>{ownedTenant._count.posts}</strong><Megaphone size={18} /></article>
                <article><span>{role === "SUPER_ADMIN" ? labels.platformAccess : labels.subscription}</span><strong className="stat-small">{role === "SUPER_ADMIN" ? labels.fullFreeAccess : ownedTenant.subscription?.status ?? labels.notConfigured}</strong><ShieldCheck size={18} /></article>
                <article><span>{role === "SUPER_ADMIN" ? labels.partnerAccess : labels.expiresOn}</span><strong className="stat-small">{role === "SUPER_ADMIN" ? labels.allFeatures : ownedTenant.subscription ? new Intl.DateTimeFormat(preferences?.language === "en" ? "en-GB" : preferences?.language === "es" ? "es-ES" : "fr-FR", { dateStyle: "medium" }).format(ownedTenant.subscription.currentPeriodEnd) : "—"}</strong><BarChart3 size={18} /></article>
              </div>
              {role === "ADMIN" && <div className="admin-actions dashboard-quick-actions">
                <Link className="button button-dark" href="/dashboard?tab=subscription">{labels.viewPaySubscription} <ArrowRight size={15} /></Link>
              </div>}
              {ownedTenant.status === "ACTIVE" && (role === "SUPER_ADMIN" || currentTab !== "overview") && <DashboardTools role={role} tab={currentTab} tenantHandle={ownedTenant.handle} tenantName={ownedTenant.displayName} subscription={ownedTenant.subscription} canPublish={canPublish} canPublishPaid={canPublishPaid} />}
            </>
          )}

          {role === "ADMIN" && ownedTenant?.status === "ACTIVE" && currentTab !== "overview" && (
            <DashboardTools role={role} tab={currentTab} tenantHandle={ownedTenant.handle} tenantName={ownedTenant.displayName} subscription={ownedTenant.subscription} canPublish={canPublish} canPublishPaid={canPublishPaid} />
          )}

          {role === "SUPER_ADMIN" && currentTab !== "overview" && (
            <DashboardTools role={role} tab={currentTab} tenantHandle={ownedTenant?.handle ?? ""} tenantName={ownedTenant?.displayName ?? ""} subscription={ownedTenant?.subscription} canPublish={canPublish} canPublishPaid={canPublishPaid} />
          )}

          {role === "PLAYER" && (
            currentTab === "partner"
              ? <DashboardTools role={role} tab={currentTab} />
              : memberships.length > 0
              ? <DashboardTools role={role} tab={currentTab} tenantHandle={memberships[0].tenant.handle} tenantName={memberships[0].tenant.displayName} canReportAdmin={canReportAdmin} />
              : <div className="empty-feed dashboard-empty">
                  <span className="empty-icon"><Trophy size={20} /></span>
                  <h2>{labels.joinCommunityTitle}</h2>
                  <p>{labels.joinCommunityDescription}</p>
                  <Link href="/" className="button button-lime">{labels.findDashboardSpace} <ArrowRight size={15} /></Link>
                </div>
          )}
        </section>
      </div>
      <footer className="site-footer">
        <Link className="brand brand-footer" href="/"><span className="brand-mark"><Trophy size={16} /></span><span>web<span className="brand-accent">mondial</span></span></Link>
        <span>{labels.dashboardDisclaimer}</span>
        <Link href="/">{labels.homeLink}</Link>
        <small className="footer-copyright">© {new Date().getFullYear()} Web Mondial. {labels.allRightsReserved}</small>
      </footer>
    </main>
  );
}

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading"><DashboardLoadingLabel /></main>}>
      <DashboardPageContent searchParams={searchParams} />
    </Suspense>
  );
}

function DashboardLoadingLabel() {
  return <T id="loadingWorkspace" />;
}

async function DashboardPageContent({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "feed" } = await searchParams;
  return <DashboardContent tab={tab} />;
}
