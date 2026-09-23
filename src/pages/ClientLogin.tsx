import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { Loader2, UserRound } from "lucide-react";
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

export default function ClientLogin() {
  const {
    login,
    registerClient,
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
      await login(email.trim().toLowerCase(), password, { portal: "client" });
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
      window.setTimeout(() => switchMode("login"), 1500);
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
      await registerClient({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        organizationName: organizationName.trim(),
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to create client account. Please try again."));
    }
  }

  const displayError =
    error ?? (mode === "login" && loginError ? loginError.message || "Invalid email or password" : null);

  const title =
    mode === "register"
      ? "Create client workspace"
      : mode === "forgot"
        ? "Reset password"
        : "Client portal sign in";

  const subtitle =
    mode === "register"
      ? "Manage projects, tasks, invoices, and invite your delivery team."
      : mode === "forgot"
        ? "Enter a new password for your client account."
        : "Sign in to your client dashboard.";

  return (
    <OrgAuthShell
      organizationLabel={
        mode === "register" ? organizationName.trim() || "Your organization" : undefined
      }
    >
      <div className="text-center mb-6 -mt-2">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {mode === "login" ? (
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="client-email">Email</Label>
            <Input
              id="client-email"
              type="email"
              autoComplete="email"
              placeholder="ben@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-password">Password</Label>
            <PasswordInput
              id="client-password"
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
            className="w-full h-11 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
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
              className="text-sm text-[#2563EB] hover:underline"
            >
              Forget password?
            </button>
          </div>
        </form>
      ) : null}

      {mode === "forgot" ? (
        <form onSubmit={handleForgotPassword} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forgot-password">New password</Label>
            <PasswordInput
              id="forgot-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forgot-confirm">Confirm password</Label>
            <PasswordInput
              id="forgot-confirm"
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
            className="w-full h-11 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-semibold"
          >
            {isResettingPassword ? "Updating password..." : "Update password"}
          </button>
          <button type="button" onClick={() => switchMode("login")} className="w-full text-sm text-gray-500">
            Back to sign in
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-email">Email</Label>
            <Input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-password">Password</Label>
            <PasswordInput
              id="register-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-confirm">Confirm password</Label>
            <PasswordInput
              id="register-confirm"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <p className="text-xs text-gray-500">
            Invite your delivery team from Team. They join as employees in your workspace so you can assign tasks.
          </p>
          {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-semibold flex items-center justify-center gap-2"
          >
            {isRegistering ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating workspace...
              </>
            ) : (
              "Create client workspace"
            )}
          </button>
          <button type="button" onClick={() => switchMode("login")} className="w-full text-sm text-gray-500">
            Already have an account? Sign in
          </button>
        </form>
      ) : null}

      {mode === "login" ? (
        <div className="mt-6 pt-6 border-t border-gray-100 space-y-3">
          <button
            type="button"
            onClick={() => switchMode("register")}
            className="w-full h-11 px-3 rounded-lg border border-teal-200 bg-teal-50/60 text-sm font-medium text-teal-900 hover:bg-teal-50 transition-colors inline-flex items-center justify-center gap-2"
          >
            <UserRound size={16} className="text-teal-600" />
            Create client workspace
          </button>
          <p className="text-center text-sm text-gray-500 pt-1">
            Invited teammate? Sign in here with the email you were invited with.
          </p>
        </div>
      ) : null}
    </OrgAuthShell>
  );
}
