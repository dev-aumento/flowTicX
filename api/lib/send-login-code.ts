import { isMailConfigured, sendMail } from "./mail";

export function isLoginEmailConfigured() {
  return isMailConfigured();
}

export async function sendClientLoginCodeEmail(to: string, code: string) {
  return sendMail({
    to,
    fromName: "aaso",
    subject: "Your AASO client portal sign-in code",
    text: [
      `Your sign-in code is ${code}.`,
      "It expires in 10 minutes.",
      "If you did not try to sign in, you can ignore this email.",
    ].join("\n"),
  });
}
