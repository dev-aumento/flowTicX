import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ChevronRight, Loader2, Lock, Mail, UserRound } from "lucide-react";
import { LoginShowcase } from "@/components/auth/LoginShowcase";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { isPlanEndedMessage, displayPlanEndedMessage } from "@/lib/plan-ended";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "admin" | "forgot";

const fieldClass =
  "h-12 rounded-xl border-gray-200 bg-white pl-10 text-[15px] text-gray-900 shadow-none placeholder:text-gray-400 dark:border-gray-200 dark:bg-white dark:text-gray-900";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return displayPlanEndedMessage(err.message) || fallback;
  if (err instanceof Error) return displayPlanEndedMessage(err.message) || fallback;
  return fallback;
}

export default function Login() {
  const {
    login,
    registerAdmin,
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
      await login(email.trim().toLowerCase(), password);
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

  async function handleRegisterAdmin(event: React.FormEvent) {
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
      await registerAdmin({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        organizationName: organizationName.trim(),
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to create admin account. Please try again."));
    }
  }

  const displayError =
    error ??
    (mode === "login" && loginError
      ? isPlanEndedMessage(loginError.message)
        ? displayPlanEndedMessage(loginError.message)
        : "Invalid email or password"
      : null);

  const title =
    mode === "admin"
      ? "Create your workspace"
      : mode === "forgot"
        ? "Reset password"
        : "Welcome back";

  const subtitle =
    mode === "admin"
      ? "Set up your company workspace and invite your team."
      : mode === "forgot"
        ? "Enter a new password for your account."
        : "Sign in to your AASO workspace.";

  return (
    <div className="min-h-dvh overflow-x-hidden bg-[#F3F6FB] text-gray-900 lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:overflow-hidden">
      <LoginShowcase />

      <div className="relative flex min-h-dvh min-w-0 flex-col overflow-x-hidden lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div
          className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-[#DBEAFE]/80 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute bottom-10 left-0 h-56 w-56 rounded-full bg-[#E0E7FF]/70 blur-3xl"
          aria-hidden
        />

        <div className="relative z-10 flex w-full min-w-0 flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-10">
          <div className="w-full min-w-0 max-w-[440px] rounded-[28px] bg-white px-5 py-7 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:px-8 sm:py-9">
            <div className="mb-6 text-center">
              <div className="mb-5 flex justify-center">
                <BrandLogo variant="light" imgClassName="h-8 w-8" />
              </div>
              <h1 className="text-[1.65rem] font-bold tracking-tight text-[#111827]">{title}</h1>
              <p className="mt-1.5 text-sm text-gray-500">{subtitle}</p>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="w-full min-w-0 space-y-4">
                <Field label="Email" htmlFor="email" icon={Mail}>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={fieldClass}
                    required
                  />
                </Field>
                <Field label="Password" htmlFor="password" icon={Lock}>
                  <PasswordInput
                    id="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                    required
                  />
                </Field>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    Forgot password?
                  </button>
                </div>
                {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
                <PrimaryButton busy={isLoggingIn} label="Continue" busyLabel="Signing in..." />
              </form>
            ) : null}

            {mode === "forgot" ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <Field label="Email" htmlFor="forgot-email" icon={Mail}>
                  <Input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={fieldClass}
                    required
                  />
                </Field>
                <Field label="New password" htmlFor="new-password" icon={Lock}>
                  <PasswordInput
                    id="new-password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                    required
                    minLength={8}
                  />
                </Field>
                <Field label="Confirm password" htmlFor="confirm-new-password" icon={Lock}>
                  <PasswordInput
                    id="confirm-new-password"
                    autoComplete="new-password"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={fieldClass}
                    required
                    minLength={8}
                  />
                </Field>
                {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
                {success ? <p className="text-sm text-green-600">{success}</p> : null}
                <PrimaryButton
                  busy={isResettingPassword}
                  disabled={!!success}
                  label="Update password"
                  busyLabel="Updating password..."
                />
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="w-full text-sm text-gray-500 hover:text-gray-800"
                >
                  Back to sign in
                </button>
              </form>
            ) : null}

            {mode === "admin" ? (
              <form onSubmit={handleRegisterAdmin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-org" className="text-sm font-medium text-gray-700">
                    Organization name
                  </Label>
                  <Input
                    id="admin-org"
                    type="text"
                    placeholder="Acme Inc."
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    className={cn(fieldClass, "pl-3.5")}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name" className="text-sm font-medium text-gray-700">
                    Full name
                  </Label>
                  <Input
                    id="admin-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={cn(fieldClass, "pl-3.5")}
                    required
                  />
                </div>
                <Field label="Email" htmlFor="admin-email" icon={Mail}>
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={fieldClass}
                    required
                  />
                </Field>
                <Field label="Password" htmlFor="admin-password" icon={Lock}>
                  <Input
                    id="admin-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                    required
                    minLength={8}
                  />
                </Field>
                <Field label="Confirm password" htmlFor="admin-confirm" icon={Lock}>
                  <Input
                    id="admin-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={fieldClass}
                    required
                    minLength={8}
                  />
                </Field>
                {displayError ? <p className="text-sm text-red-500">{displayError}</p> : null}
                <PrimaryButton
                  busy={isRegistering}
                  label="Create your workspace"
                  busyLabel="Creating workspace..."
                />
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
              <div className="mt-6">
                <div className="flex items-center gap-3 text-[11px] font-medium tracking-[0.14em] text-gray-400">
                  <span className="h-px flex-1 bg-gray-200" />
                  OR
                  <span className="h-px flex-1 bg-gray-200" />
                </div>

                <div className="mt-5 text-center">
                  <p className="text-sm font-semibold text-[#111827]">New to AASO?</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Set up your company workspace and invite your team.
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode("admin")}
                    className="mt-3 h-11 w-full rounded-xl border border-[#BFDBFE] bg-white text-sm font-semibold text-[#2563EB] transition-colors hover:bg-[#EFF6FF]"
                  >
                    Create your workspace
                  </button>
                </div>

                <Link
                  to="/client/login"
                  className="mt-4 flex items-center gap-3 rounded-2xl bg-[#F4F8FF] px-3.5 py-3.5 transition-colors hover:bg-[#EAF2FF]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#E5EEFF] text-[#2563EB]">
                    <UserRound size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#111827]">
                      Are you a client?
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                      Access your projects, approvals and account information.
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[#2563EB]">
                      Go to Client Portal
                      <ArrowRight size={14} />
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-gray-300" />
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="relative z-10 flex flex-col gap-2 px-5 py-4 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} AASO. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Privacy</span>
            <span>Terms</span>
            <span>Help</span>
            <Link to="/admin/login" className="hover:text-[#2563EB]">
              Platform admin
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  icon: Icon,
  children,
}: {
  label: string;
  htmlFor: string;
  icon: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-gray-700">
        {label}
      </Label>
      <div className="relative w-full min-w-0">
        <Icon
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-gray-400"
        />
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({
  busy,
  disabled,
  label,
  busyLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
    >
      {busy ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {busyLabel}
        </>
      ) : (
        <>
          {label}
          {label === "Continue" ? <ArrowRight size={16} /> : null}
        </>
      )}
    </button>
  );
}

