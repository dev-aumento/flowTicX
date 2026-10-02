import { describe, expect, it } from "vitest";
import { buildPasswordResetEmail, passwordResetMessage } from "./send-password-reset";

describe("password reset email", () => {
  it("tells the reader to use the code and includes a verify link", () => {
    const code = "482913";
    const resetUrl = "https://app.aaso.tech/login?email=ada%40aaso.tech&code=482913";
    const email = buildPasswordResetEmail({ code, resetUrl });

    expect(passwordResetMessage(code)).toBe("Use the code 482913 to reset the password.");
    expect(email.subject).toBe("Reset your AASO password");
    expect(email.text).toContain("Use the code 482913 to reset the password.");
    expect(email.text).toContain(resetUrl);
    expect(email.html).toContain("Use the code <strong>482913</strong> to reset the password.");
    expect(email.html).toContain(
      'href="https://app.aaso.tech/login?email=ada%40aaso.tech&amp;code=482913"',
    );
    expect(email.html).toContain("Verify and reset password");
  });
});
