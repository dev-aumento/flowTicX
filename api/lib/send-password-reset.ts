import { isMailConfigured, sendMail } from "./mail";
import { publicAppOrigin } from "./request-origin";

const TEXT = "#111827";
const BUTTON = "#2563EB";

export const PASSWORD_RESET_LOGIN_PATHS = [
  "/login",
  "/client/login",
  "/finance/login",
  "/admin/login",
] as const;

export type PasswordResetLoginPath = (typeof PASSWORD_RESET_LOGIN_PATHS)[number];

export function passwordResetUrl(loginPath: PasswordResetLoginPath, email: string, code: string) {
  const origin = publicAppOrigin().replace(/\/$/, "");
  const path = `${loginPath}?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
  return origin ? `${origin}${path}` : path;
}

export function passwordResetMessage(code: string) {
  return `Use the code ${code} to reset the password.`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPasswordResetEmail(input: { code: string; resetUrl: string }) {
  const instruction = passwordResetMessage(input.code);
  const resetHref = escapeHtml(input.resetUrl);
  const text = [
    instruction,
    "",
    "This code expires in 10 minutes.",
    "",
    "Verify the code and reset your password:",
    input.resetUrl,
    "",
    "If you did not ask to reset your password, you can ignore this email.",
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:${TEXT};font-size:15px;line-height:1.55">
  <p style="margin:0 0 16px">${instruction.replace(input.code, `<strong>${input.code}</strong>`)}</p>
  <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase">Verification code</p>
  <p style="margin:0 0 20px;font-size:32px;letter-spacing:8px;font-weight:700">${input.code}</p>
  <p style="margin:0 0 20px">This code expires in 10 minutes.</p>
  <p style="margin:0 0 20px">
    <a href="${resetHref}" style="display:inline-block;background:${BUTTON};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px">Verify and reset password</a>
  </p>
  <p style="margin:0 0 8px">Or open this link to verify the code and choose a new password:</p>
  <p style="margin:0 0 20px"><a href="${resetHref}" style="color:${TEXT}">${resetHref}</a></p>
  <p style="margin:0;color:${TEXT}">If you did not ask to reset your password, you can ignore this email.</p>
</div>`;

  return {
    subject: "Reset your AASO password",
    text,
    html,
  };
}

export async function sendPasswordResetEmail(input: {
  to: string;
  code: string;
  loginPath: PasswordResetLoginPath;
}) {
  const resetUrl = passwordResetUrl(input.loginPath, input.to, input.code);
  const email = buildPasswordResetEmail({ code: input.code, resetUrl });
  return sendMail({
    to: input.to,
    fromName: "AASO",
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

export function isPasswordResetEmailConfigured() {
  return isMailConfigured();
}
