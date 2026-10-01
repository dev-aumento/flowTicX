import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

export function getMailer() {
  if (!isMailConfigured()) return null;
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD ?? "",
        }
      : undefined,
  });
  return transporter;
}

function mailboxAddress() {
  const raw = (process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  const wrapped = raw.match(/<([^>]+)>/);
  return (wrapped?.[1] ?? raw).replace(/^"|"$/g, "").trim();
}

/** Inbox name: the person, then their email, then aaso. Never the no-reply mailbox. */
export function senderDisplayName(name?: string | null, email?: string | null) {
  const cleanedName = (name ?? "").replace(/[\r\n"]/g, "").trim();
  if (cleanedName && !/no-reply@/i.test(cleanedName)) return cleanedName;
  const cleanedEmail = (email ?? "").replace(/[\r\n"]/g, "").trim();
  if (cleanedEmail && !/no-reply@/i.test(cleanedEmail)) return cleanedEmail;
  return "aaso";
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string | null;
  fromEmail?: string | null;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
  }>;
}) {
  const mailer = getMailer();
  if (!mailer) return { delivered: false as const };

  const address = mailboxAddress();
  await mailer.sendMail({
    from: {
      name: senderDisplayName(input.fromName, input.fromEmail),
      address,
    },
    envelope: {
      from: address,
      to: input.to,
    },
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });
  return { delivered: true as const };
}
