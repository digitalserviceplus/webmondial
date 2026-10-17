import nodemailer from "nodemailer";

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const serverUrl = process.env.EMAIL_SERVER_URL;
  const from = process.env.EMAIL_FROM;
  if (!serverUrl || !from) {
    throw new Error("Configurez EMAIL_SERVER_URL et EMAIL_FROM pour envoyer les emails de récupération.");
  }

  const transporter = nodemailer.createTransport(serverUrl);
  await transporter.sendMail({
    from,
    to: email,
    subject: "Réinitialiser votre mot de passe Web Mondial",
    text: `Une demande de réinitialisation a été effectuée pour votre compte Web Mondial.\n\nOuvrez ce lien dans les 30 prochaines minutes :\n${resetUrl}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet email.`,
    html: `<p>Une demande de réinitialisation a été effectuée pour votre compte Web Mondial.</p><p><a href="${resetUrl}">Choisir un nouveau mot de passe</a></p><p>Ce lien expire dans 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>`,
  });
}
