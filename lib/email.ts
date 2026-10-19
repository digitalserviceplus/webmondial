import nodemailer from "nodemailer";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emailLayout(title: string, content: string) {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;background-color:#07111f;color:#edf5ff;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#07111f;padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#0d1d30;border:1px solid #20354b;border-radius:16px">
          <tr><td style="padding:28px 32px 12px;text-align:center">
            <span style="display:inline-block;padding:9px 12px;border-radius:10px;background-color:#5b9cff;color:#07111f;font-weight:bold">WM</span>
            <p style="margin:12px 0 0;color:#edf5ff;font-size:20px;font-weight:bold">web<span style="color:#7bb8ff">mondial</span></p>
          </td></tr>
          <tr><td style="padding:12px 32px 28px">
            <h1 style="margin:0 0 16px;color:#edf5ff;font-size:23px;line-height:1.3">${title}</h1>
            ${content}
            <p style="margin:28px 0 0;border-top:1px solid #20354b;padding-top:18px;color:#96a9bf;font-size:12px;line-height:1.6">Web Mondial · Sécurité de votre compte<br>Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function actionLink(label: string, url: string) {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background-color:#5b9cff;color:#07111f;font-weight:bold;text-decoration:none">${label}</a></p>`;
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !from) {
    throw new Error("Configurez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD et SMTP_FROM.");
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass: password },
    tls: { minVersion: "TLSv1.2" },
  });
  return { transporter, from };
}

export function isEmailDeliveryConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    Number.isInteger(Number(process.env.SMTP_PORT)) &&
    Number(process.env.SMTP_PORT) > 0 &&
    Number(process.env.SMTP_PORT) <= 65535 &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.SMTP_FROM,
  );
}

export function getAppUrl(request?: Request) {
  const configuredUrl = process.env.APP_URL ||
    (process.env.NODE_ENV === "production" ? undefined : process.env.NEXT_PUBLIC_APP_URL);
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("APP_URL doit être une origine HTTP ou HTTPS sans chemin, avec HTTPS en production.");
    }
    return url;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configurez APP_URL avec l’origine HTTPS de Web Mondial.");
  }
  return new URL(request?.url ?? "http://localhost:3000");
}

export async function sendVerificationEmail(email: string, code: string, verificationUrl: string) {
  const { transporter, from } = createTransport();
  const html = emailLayout(
    "Confirmez votre adresse email",
    `<p style="color:#c5d2df;font-size:15px;line-height:1.7">Utilisez ce code pour vérifier votre adresse et activer votre compte :</p>
      <p style="margin:24px 0;padding:16px;border-radius:10px;background-color:#07111f;color:#7bb8ff;font-size:28px;font-weight:bold;letter-spacing:8px;text-align:center">${escapeHtml(code)}</p>
      <p style="color:#c5d2df;font-size:14px;line-height:1.7">Ce code expire dans 15 minutes et ne peut être utilisé qu’une seule fois.</p>
      ${actionLink("Ouvrir Web Mondial", verificationUrl)}`,
  );
  await transporter.sendMail({
    from,
    to: email,
    subject: "Confirmez votre adresse email — Web Mondial",
    text: `Confirmez votre adresse email Web Mondial avec ce code : ${code}\n\nIl expire dans 15 minutes et ne peut être utilisé qu’une seule fois. Si vous n’êtes pas à l’origine de cette inscription, ignorez cet email.`,
    html,
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const { transporter, from } = createTransport();
  const html = emailLayout(
    "Réinitialisez votre mot de passe",
    `<p style="color:#c5d2df;font-size:15px;line-height:1.7">Une demande de réinitialisation a été effectuée pour votre compte Web Mondial.</p>
      ${actionLink("Choisir un nouveau mot de passe", resetUrl)}
      <p style="color:#c5d2df;font-size:14px;line-height:1.7">Ce lien expire dans 30 minutes et ne peut être utilisé qu’une seule fois.</p>`,
  );
  await transporter.sendMail({
    from,
    to: email,
    subject: "Réinitialiser votre mot de passe — Web Mondial",
    text: `Une demande de réinitialisation a été effectuée pour votre compte Web Mondial.\n\nOuvrez ce lien dans les 30 prochaines minutes :\n${resetUrl}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet email.`,
    html,
  });
}

export async function sendPasswordChangedEmail(email: string, signInUrl: string) {
  const { transporter, from } = createTransport();
  const html = emailLayout(
    "Votre mot de passe a été modifié",
    `<p style="color:#c5d2df;font-size:15px;line-height:1.7">Le mot de passe de votre compte Web Mondial vient d’être modifié.</p>
      ${actionLink("Se connecter", signInUrl)}
      <p style="color:#c5d2df;font-size:14px;line-height:1.7">Si vous n’êtes pas à l’origine de cette modification, contactez l’administration de la plateforme.</p>`,
  );
  await transporter.sendMail({
    from,
    to: email,
    subject: "Votre mot de passe a été modifié — Web Mondial",
    text: `Le mot de passe de votre compte Web Mondial vient d’être modifié.\n\nConnectez-vous : ${signInUrl}\n\nSi vous n’êtes pas à l’origine de cette modification, contactez l’administration de la plateforme.`,
    html,
  });
}
