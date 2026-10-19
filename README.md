# Web Mondial

Web Mondial is a multi-tenant sports community platform built with Next.js App Router, TypeScript, PostgreSQL, Prisma, and Auth.js.

## Implemented workflows

- Public landing page, tenant search, public tenant profiles, metadata, and redirects from approved legacy handles.
- Public sitemap and crawler rules generated from active partner spaces.
- Player registration, credential sign-in, one-time admin général setup, and one-time partner-admin activation.
- Role-aware player, partner, and admin général dashboards with profile photo, account details, language/theme preferences, and password updates.
- Email-only player sign-up and sign-in, with expiring one-time email verification codes and server-side attempt/resend limits.
- Single-use, expiring password reset links sent by the configured SMTP server, with a confirmation email after password changes.
- Tenant membership, publication feeds and categories, post composition, likes, reports, and bookmaker management.
- Image/video uploads stored on the server, with signature-based type checks and visibility-aware delivery.
- Partner applications, agreement acceptance, subscription status, tenant moderation, user invitations, identifier-change review, and global plan/support/contract settings.
- PostgreSQL-backed tenant-scoped records, payment state transitions, rate limits, and audit logs.
- SasPay hosted checkout for partner subscriptions and paid publications, account-country preselection, server-side payment verification, idempotent settlement (duplicate callbacks cannot extend or unlock a payment twice), and signed webhook handling.
- A deliberately restricted mock payment flow for local development when no SasPay API key is configured; it is disabled in production.

## Integration boundaries

- SasPay's API key belongs only in the ignored server-side `.env` as `SASPAY_API_KEY`; adding it enables hosted checkout and never exposes it to the browser. Checkout returns are verified against SasPay before a subscription is extended or content is unlocked. To enable signed webhook delivery, open the SasPay dashboard at [app.saspay.me](https://app.saspay.me), create a webhook for `https://<your-domain>/api/payments/saspay/webhook`, select the production environment, and subscribe it to `transaction.success`, `transaction.failed`, and `transaction.cancelled`. Copy the signing secret when SasPay shows it; it cannot be viewed again. Add it to the Vercel project's Production environment as `SASPAY_WEBHOOK_SECRET`, then redeploy. Never paste the value into Git, chat, or client-side variables. If lost, use the dashboard's Webhooks → Change secret action, update Vercel with the newly displayed value, and redeploy. Set `APP_URL` to the public HTTPS origin in production. See the [official SasPay webhook documentation](https://docs.saspay.me/api-reference/webhooks).
- Post media can use HTTPS URLs or server-side uploads (JPEG/PNG/GIF/WebP and MP4/WebM, maximum 20 MB). Local uploads are stored under `.local-data/uploads`; production uses a private Vercel Blob store and continues serving media through the authenticated application route.
- Email verification and password recovery use Gmail-compatible SMTP settings in `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `APP_URL`. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, and `SMTP_USER`/`SMTP_FROM` to your Gmail address; use a Google App Password for `SMTP_PASSWORD`. Never use your normal Google password or commit the app password.
- To create a Google App Password, enable 2-Step Verification on the Google account, then open Google Account → Security → App passwords, create an app password for Web Mondial, and store the generated value directly in the local ignored `.env` or hosting-provider secret settings. If the App passwords option is unavailable, the Google account or organization may not permit it.
- Set `APP_URL` to the public HTTPS origin in production. Do not share SMTP secrets in chat, logs, browser responses, or Git. Development also sends emails through SMTP; verification and recovery links/codes are never returned in API responses.
- French, English, and Spanish can be selected on the public site and authentication pages; account language and theme preferences are saved to the profile.
- Committed Prisma migrations keep the database schema in sync. Local development uses an embedded PostgreSQL-compatible database; production uses managed PostgreSQL on Neon.

## Requirements

- Node.js 20.9 or newer.
- npm.

## Local setup

Run the development server:

```bash
npm run dev
```

On the first run, the development launcher creates a local `.env`, starts an embedded PostgreSQL-compatible database, applies the committed migrations, and starts Next.js. Database files persist in `.local-data/`; Docker and a separately installed PostgreSQL service are not required for local development. The generated `.env` and database files are ignored by Git.

Open [http://localhost:3000](http://localhost:3000). The launcher prints a one-time setup code while no admin général exists. Open [http://localhost:3000/configuration](http://localhost:3000/configuration) and use that code to create the first admin général account. The setup code remains in `.env` and is only for the initial local account.

To use an existing PostgreSQL server instead, set its `DATABASE_URL` in `.env`; the launcher will apply migrations to that database and will not start the embedded database.

An optional demo partner can be created by setting `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (at least 12 characters) in `.env`, then running:

   ```bash
   npm run db:seed
   ```

   The seeded space is available at `/${SEED_TENANT_HANDLE}` (defaults to `/xpro-demo`). Seed credentials are supplied by the operator and are not committed to the repository.

## Useful commands

```bash
npm run typecheck
npm run lint
npm run test
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run build
```

## Production migration and deployment

The local database and uploads under `.local-data` are ignored by Git and must never be committed. Create a local-only `.env.migration.local` file containing `NEON_DIRECT_URL` (the unpooled Neon connection string) and `BLOB_READ_WRITE_TOKEN` (a private Blob store read-write token). Do not send these values in chat or add the file to Git.

1. Create the Neon production database and connect a private Vercel Blob store to the Vercel project.
2. Run `npm run neon:check` to list local table row counts without changing either database.
3. Run `npm run neon:import` to create a local backup under `.local-data/migration-backups`, apply committed Prisma migrations to the empty Neon database, then copy all application rows in foreign-key order. The importer refuses a non-empty target and leaves the local database unchanged.
4. Run `npm run media:migrate` to copy existing uploads to private Blob paths while preserving their media IDs and application URLs.
5. Configure Vercel production variables: `DATABASE_URL` (Neon pooled connection), `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `APP_URL`, a random `INITIAL_SETUP_TOKEN`, and `CRON_SECRET`. Set `SASPAY_API_KEY` and `SASPAY_WEBHOOK_SECRET` directly in Vercel when enabling live payments; configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` for verification and account emails. Never expose these values in the browser, Git, or chat.
6. Verify the SasPay webhook URL at `https://<production-domain>/api/payments/saspay/webhook`, and remove `INITIAL_SETUP_TOKEN` from Vercel after creating the first admin général.

Apply committed schema changes through `npm run db:deploy`. Never run the import against a database that already contains live production data.
