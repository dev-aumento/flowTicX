import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { Link } from "react-router";
import { Loader2, Shield } from "lucide-react";
import { OrgAuthShell } from "@/components/auth/OrgAuthShell";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

type AuthMode = "login" | "register" | "forgot";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function PlatformLogin() {
  const {
    login,
    registerPlatform,
    resetPassword,
    isLoggingIn,
    isRegistering,
    isResettingPassword,
    loginError,
  } = useAuth();
  const { data: signup } = trpc.auth.platformSignupAvailable.useQuery(undefined, {
    staleTime: 30_000,
  });

  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const busy = isLoggingIn || isRegistering || isResettingPassword;
  const canRegister = signup?.available === true;

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
      await login(email.trim().toLowerCase(), password, { portal: "platform" });
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
      setError("Passwords do not match");
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
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await registerPlatform({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        organizationName: "Aaso",
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to create platform administrator."));
    }
  }

  const displayError =
    error ?? (mode === "login" && loginError ? loginError.message || "Invalid email or password" : null);

  const title =
    mode === "register"
      ? "Create master admin"
      : mode === "forgot"
        ? "Reset password"
        : "Master admin sign in";

  const subtitle =
    mode === "register"
      ? "First-time setup for the Aaso platform console."
      : mode === "forgot"
        ? "Enter a new password for your platform account."
        : "Monitor customers, trials, and subscription activity.";

  return (
    <OrgAuthShell organizationLabel="Aaso">
      <div className="text-center mb-6 -mt-2">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB]">
          <Shield size={18} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {mode === "login" ? (
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="platform-email">Email</Label>
            <Input
              id="platform-email"
              type="email"
              autoComplete="email"
              placeholder="admin@Aaso.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-password">Password</Label>
            <PasswordInput
              id="platform-password"
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
            className="w-full h-11 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
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
          {success ? <p className="text-sm text-emerald-600">{success}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white font-semibold text-[15px] flex items-center justify-center gap-2"
          >
            {isResettingPassword ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Updating...
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

      {mode === "register" && canRegister ? (
        <form onSubmit={handleRegister} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="platform-name">Full name</Label>
            <Input
              id="platform-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-register-email">Email</Label>
            <Input
              id="platform-register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-register-password">Password</Label>
            <PasswordInput
              id="platform-register-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-register-confirm">Confirm password</Label>
            <PasswordInput
              id="platform-register-confirm"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>
          {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white font-semibold text-[15px] flex items-center justify-center gap-2"
          >
            {isRegistering ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating...
              </>
            ) : (
              "Create master admin"
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
          {canRegister ? (
            <button
              type="button"
              onClick={() => switchMode("register")}
              className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:border-[#2563EB]/40 hover:bg-blue-50/50 transition-colors"
            >
              First-time setup
            </button>
          ) : null}
          <p className="text-center text-sm text-gray-500">
            Staff workspace?{" "}
            <Link to="/login" className="text-[#2563EB] hover:underline font-medium">
              Sign in at /login
            </Link>
          </p>
        </div>
      ) : null}
    </OrgAuthShell>
  );
}
