import nodemailer from "nodemailer";

export function isLoginEmailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

export async function sendClientLoginCodeEmail(to: string, code: string) {
  if (!isLoginEmailConfigured()) {
    return { delivered: false as const };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD ?? "",
        }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your AASO client portal sign-in code",
    text: [
      `Your sign-in code is ${code}.`,
      "It expires in 10 minutes.",
      "If you did not try to sign in, you can ignore this email.",
    ].join("\n"),
  });

  return { delivered: true as const };
}
