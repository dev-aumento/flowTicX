import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { displayPlanEndedMessage } from "@/lib/plan-ended";
import { cn } from "@/lib/utils";

export type PasswordResetLoginPath = "/login" | "/client/login" | "/finance/login" | "/admin/login";
export type PasswordResetPhase = "email" | "code" | "password";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return displayPlanEndedMessage(err.message) || fallback;
  if (err instanceof Error) return displayPlanEndedMessage(err.message) || fallback;
  return fallback;
}

export function ForgotPasswordForm({
  email,
  onEmailChange,
  initialCode = "",
  loginPath,
  inputClassName,
  buttonClassName,
  showHeading = false,
  onPhaseChange,
  onSuccess,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  initialCode?: string;
  loginPath: PasswordResetLoginPath;
  inputClassName?: string;
  buttonClassName?: string;
  showHeading?: boolean;
  onPhaseChange?: (phase: PasswordResetPhase) => void;
  onSuccess: () => void;
}) {
  const {
    requestPasswordReset,
    confirmPasswordResetCode,
    resetPassword,
    isRequestingPasswordReset,
    isConfirmingPasswordReset,
    isResettingPassword,
  } = useAuth();
  const [phase, setPhase] = useState<PasswordResetPhase>(initialCode ? "code" : "email");
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fieldClass = cn("h-12 rounded-xl border-gray-200 bg-white text-[15px]", inputClassName);
  const buttonClass = cn(
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60",
    buttonClassName,
  );
  const passwordsMatch = password.length >= 8 && password === confirmPassword;
  const codeReady = /^\d{6}$/.test(code.trim());

  function moveTo(next: PasswordResetPhase) {
    setPhase(next);
    onPhaseChange?.(next);
  }

  async function handleRequestCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    try {
      await requestPasswordReset(email.trim().toLowerCase(), loginPath);
      setCode("");
      setPassword("");
      setConfirmPassword("");
      moveTo("code");
      setNotice("Verification code sent. Check your email.");
    } catch (err) {
      setError(errorMessage(err, "Unable to send the verification code. Please try again."));
    }
  }

  async function handleConfirmCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!codeReady) {
      setError("Enter the 6-digit verification code");
      return;
    }
    try {
      await confirmPasswordResetCode(email.trim().toLowerCase(), code.trim());
      setPassword("");
      setConfirmPassword("");
      moveTo("password");
    } catch (err) {
      setError(errorMessage(err, "That verification code is incorrect."));
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!passwordsMatch) return;
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), password);
      setNotice("Password has been updated successfully");
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(onSuccess, 1200);
    } catch (err) {
      setError(errorMessage(err, "Unable to update password. Please try again."));
    }
  }

  const intro =
    phase === "email"
      ? "Enter your email and we'll send a 6-digit verification code."
      : phase === "code"
        ? "Enter the verification code from your email."
        : "Choose a new password.";

  const submitDisabled =
    (phase === "code" && !codeReady) ||
    (phase === "password" && !passwordsMatch) ||
    (phase === "password" && notice === "Password has been updated successfully");

  return (
    <form
      onSubmit={
        phase === "email" ? handleRequestCode : phase === "code" ? handleConfirmCode : handleReset
      }
      className="space-y-4"
    >
      {showHeading ? (
        <div className="text-center">
          <h1 className="text-xl font-bold text-[#111827]">Reset password</h1>
          <p className="mt-1 text-sm text-gray-500">{intro}</p>
        </div>
      ) : null}

      {phase === "email" ? (
        <div className="space-y-1.5">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            className={fieldClass}
            required
          />
        </div>
      ) : null}

      {phase === "code" ? (
        <div className="space-y-1.5">
          <Label htmlFor="forgot-code">Verification code</Label>
          <Input
            id="forgot-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className={fieldClass}
            required
            minLength={6}
            maxLength={6}
          />
        </div>
      ) : null}

      {phase === "password" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="forgot-password">New password</Label>
            <PasswordInput
              id="forgot-password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClass}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forgot-confirm">Confirm password</Label>
            <PasswordInput
              id="forgot-confirm"
              autoComplete="new-password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={fieldClass}
              required
              minLength={8}
            />
          </div>
        </>
      ) : null}

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      {phase === "password" && confirmPassword.length > 0 && password !== confirmPassword ? (
        <p className="text-sm text-red-500">Password not match</p>
      ) : null}

      <button type="submit" disabled={submitDisabled} className={buttonClass}>
        {phase === "email" ? (
          isRequestingPasswordReset ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Sending code...
            </>
          ) : (
            "Get verification code"
          )
        ) : phase === "code" ? (
          isConfirmingPasswordReset ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Checking code...
            </>
          ) : (
            "Submit"
          )
        ) : isResettingPassword ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Updating password...
          </>
        ) : (
          "Update password"
        )}
      </button>

      {phase === "code" ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            className="text-[#2563EB] hover:text-[#1D4ED8]"
            onClick={() => {
              setError(null);
              setNotice(null);
              setCode("");
              moveTo("email");
            }}
          >
            Use a different email
          </button>
          <button
            type="button"
            className="text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-60"
            disabled={isRequestingPasswordReset}
            onClick={() => {
              setError(null);
              setNotice(null);
              void requestPasswordReset(email.trim().toLowerCase(), loginPath)
                .then(() => {
                  setCode("");
                  setNotice("A new verification code has been sent.");
                })
                .catch((err: unknown) =>
                  setError(errorMessage(err, "Unable to send the verification code. Please try again.")),
                );
            }}
          >
            Resend code
          </button>
        </div>
      ) : null}
    </form>
  );
}
