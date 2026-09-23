import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { Link } from "react-router";
import { Loader2, Wallet } from "lucide-react";
import { OrgAuthShell } from "@/components/auth/OrgAuthShell";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { displayPlanEndedMessage } from "@/lib/plan-ended";
import { useAuth } from "@/hooks/useAuth";

type AuthMode = "login" | "register" | "forgot";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return displayPlanEndedMessage(err.message) || fallback;
  if (err instanceof Error) return displayPlanEndedMessage(err.message) || fallback;
  return fallback;
}

export default function FinanceLogin() {
  const {
    login,
    registerFinance,
    resetPassword,
    isLoggingIn,
    isRegistering,
    isResettingPassword,
    loginError,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const busy = isLoggingIn || isRegistering || isResettingPassword;

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setSuccess(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await login(email.trim().toLowerCase(), password, { portal: "finance" });
    } catch (err) {
      setError(errorMessage(err, "Unable to sign in. Please try again."));
    }
  }

  async function handleForgotPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Password not match");
      return;
    }

    try {
      await resetPassword(email.trim().toLowerCase(), password);
      setSuccess("Password has been updated successfully");
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        switchMode("login");
      }, 1500);
    } catch (err) {
      setError(errorMessage(err, "Unable to update password. Please try again."));
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError("Please enter your full name");
      return;
    }
    if (!organizationName.trim()) {
      setError("Please enter your organization name");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await registerFinance({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        organizationName: organizationName.trim(),
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to create account manager account. Please try again."));
    }
  }

  const displayError =
    error ?? (mode === "login" && loginError ? loginError.message || "Invalid email or password" : null);

  const title =
    mode === "register"
      ? "Join as account manager"
      : mode === "forgot"
        ? "Reset password"
        : "Finance sign in";

  const subtitle =
    mode === "register"
      ? "Create a finance workspace for invoices and customers — without office tools."
      : mode === "forgot"
        ? "Enter a new password for your account manager account."
        : "Sign in to your finance dashboard.";

  return (
    <OrgAuthShell
      organizationLabel={
        mode === "register"
          ? organizationName.trim() || "Your organization"
          : undefined
      }
    >
      <div className="text-center mb-6 -mt-2">
        <div className="mx-auto mb-3 w-11 h-11 rounded-xl bg-amber-50 text-amber-700 inline-flex items-center justify-center">
          <Wallet size={22} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {mode === "login" ? (
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="finance-email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <Input
              id="finance-email"
              type="email"
              autoComplete="email"
              placeholder="finance@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="finance-password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <PasswordInput
              id="finance-password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            {isLoggingIn ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing in...
              </>
            ) : (
              "Continue"
            )}
          </button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="text-sm text-[#2563EB] hover:text-[#1D4ED8] hover:underline"
            >
              Forget password?
            </button>
          </div>
        </form>
      ) : null}

      {mode === "forgot" ? (
        <form onSubmit={handleForgotPassword} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="forgot-email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="finance@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-sm font-medium text-gray-700">
              New password
            </Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password" className="text-sm font-medium text-gray-700">
              Confirm password
            </Label>
            <PasswordInput
              id="confirm-new-password"
              autoComplete="new-password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
          {success ? <p className="text-sm text-green-600">{success}</p> : null}
          <button
            type="submit"
            disabled={busy || !!success}
            className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            {isResettingPassword ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Updating password...
              </>
            ) : (
              "Update password"
            )}
          </button>
          <button
            type="button"
            onClick={() => switchMode("login")}
            className="w-full text-sm text-gray-500 hover:text-gray-800"
          >
            Back to sign in
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="finance-org" className="text-sm font-medium text-gray-700">
              Organization name
            </Label>
            <Input
              id="finance-org"
              type="text"
              placeholder="Acme Inc."
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="finance-name" className="text-sm font-medium text-gray-700">
              Full name
            </Label>
            <Input
              id="finance-name"
              type="text"
              autoComplete="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="finance@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-confirm" className="text-sm font-medium text-gray-700">
              Confirm password
            </Label>
            <Input
              id="register-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <p className="text-xs text-gray-500">
            As an account manager you can manage customers and invoices. You will not see
            employees, tasks, projects, time tracking, or leave tools.
          </p>
          {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            {isRegistering ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account manager account"
            )}
          </button>
          <button
            type="button"
            onClick={() => switchMode("login")}
            className="w-full text-sm text-gray-500 hover:text-gray-800"
          >
            Already have an account? Sign in
          </button>
        </form>
      ) : null}

      {mode === "login" ? (
        <div className="mt-6 pt-6 border-t border-gray-100 space-y-3">
          <button
            type="button"
            onClick={() => switchMode("register")}
            className="w-full h-11 px-3 rounded-lg border border-amber-200 bg-amber-50/60 text-sm font-medium text-amber-900 hover:bg-amber-50 transition-colors inline-flex items-center justify-center gap-2"
          >
            <Wallet size={16} className="text-amber-600" />
            Create account manager account
          </button>
          <p className="text-center text-sm text-gray-500 pt-1">
            Not an account manager?{" "}
            <Link to="/login" className="text-[#2563EB] hover:underline">
              Use the main login
            </Link>
          </p>
        </div>
      ) : null}
    </OrgAuthShell>
  );
}
