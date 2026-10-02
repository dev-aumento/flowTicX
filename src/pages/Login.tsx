import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Info,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { ForgotPasswordForm, type PasswordResetPhase } from "@/components/auth/ForgotPasswordForm";
import { LoginShowcase } from "@/components/auth/LoginShowcase";
import { AASO_SITE_URL, BrandLogo } from "@/components/brand/BrandLogo";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { preloadGoogleSignIn, startGoogleSignIn } from "@/lib/google-sign-in";
import { displayPlanEndedMessage } from "@/lib/plan-ended";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "admin" | "forgot";
type LoginStep = "email" | "workspaces" | "password" | "missing" | "portal";
type PortalHint = "client" | "finance" | "platform";

type WorkspaceChoice = {
  organizationId: number;
  organizationName: string;
  roleLabel: string;
};

const PORTAL_HINTS: Record<PortalHint, { title: string; body: string; href: string; action: string }> = {
  client: {
    title: "This email uses the client portal",
    body: "Client workspace members sign in on the client portal.",
    href: "/client/login",
    action: "Go to Client Portal",
  },
  finance: {
    title: "This email uses the finance portal",
    body: "Account managers sign in on the finance portal.",
    href: "/finance/login",
    action: "Go to Finance sign-in",
  },
  platform: {
    title: "This email uses platform admin",
    body: "Platform administrators sign in on the admin portal.",
    href: "/admin/login",
    action: "Go to Platform admin",
  },
};

const fieldClass =
  "h-12 rounded-xl border-gray-200 bg-white pl-10 text-[15px] text-gray-900 shadow-none placeholder:text-gray-400 dark:border-gray-200 dark:bg-white dark:text-gray-900";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return displayPlanEndedMessage(err.message) || fallback;
  if (err instanceof Error) return displayPlanEndedMessage(err.message) || fallback;
  return fallback;
}

function orgInitial(name: string) {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "A";
}

export default function Login() {
  const {
    login,
    lookupWorkspaces,
    registerAdmin,
    isLoggingIn,
    isLookingUpWorkspaces,
    isRegistering,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const resetEmail = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const resetCode = searchParams.get("code")?.trim() ?? "";
  const openedFromResetLink = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail) && /^\d{6}$/.test(resetCode);

  const [mode, setMode] = useState<AuthMode>(openedFromResetLink ? "forgot" : "login");
  const [step, setStep] = useState<LoginStep>("email");
  const [resetPhase, setResetPhase] = useState<PasswordResetPhase>(openedFromResetLink ? "code" : "email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(openedFromResetLink ? resetEmail : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [portalHint, setPortalHint] = useState<PortalHint | null>(null);
  const [inactiveAccount, setInactiveAccount] = useState(false);
  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [forgotFrom, setForgotFrom] = useState<"email" | "password">("email");

  const selectedWorkspace = workspaces[selectedIndex] ?? null;
  const trackerStep: 1 | 2 | 3 = step === "email" ? 1 : step === "password" ? 3 : 2;

  useEffect(() => {
    void preloadGoogleSignIn().catch(() => undefined);
  }, []);

  function resetNotices() {
    setError(null);
    setSuccess(null);
    setSocialNotice(null);
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    resetNotices();
    setPassword("");
    setConfirmPassword("");
  }

  function backToEmail() {
    setStep("email");
    setPassword("");
    setPortalHint(null);
    setInactiveAccount(false);
    resetNotices();
  }

  function goToPrevious() {
    resetNotices();
    setPassword("");
    setConfirmPassword("");
    if (mode === "forgot") {
      setMode("login");
      setStep(forgotFrom);
      return;
    }
    if (step === "password") {
      setStep("workspaces");
      return;
    }
    backToEmail();
  }

  async function continueWithEmail(rawEmail: string) {
    resetNotices();
    const normalized = rawEmail.trim().toLowerCase();
    if (!normalized) {
      setError("Please enter your work email");
      return;
    }

    try {
      const result = await lookupWorkspaces(normalized);
      setEmail(normalized);
      if (result.workspaces.length > 0) {
        setWorkspaces(result.workspaces);
        setSelectedIndex(0);
        setPortalHint(null);
        setInactiveAccount(false);
        setStep("workspaces");
        return;
      }
      setWorkspaces([]);
      setPortalHint(result.portal);
      setInactiveAccount(result.inactive);
      setStep(result.portal ? "portal" : "missing");
    } catch (err) {
      setError(errorMessage(err, "Unable to look up your workspace. Please try again."));
    }
  }

  function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    void continueWithEmail(email);
  }

  function handleGoogleSignIn() {
    setSocialNotice(null);
    setError(null);
    setGoogleBusy(true);
    startGoogleSignIn({
      onEmail: (googleEmail) => {
        void continueWithEmail(googleEmail).finally(() => setGoogleBusy(false));
      },
      onCancel: () => setGoogleBusy(false),
      onError: (message) => {
        setGoogleBusy(false);
        setError(message);
      },
    });
  }

  function handleChooseWorkspace(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    if (!selectedWorkspace) {
      setError("Select a workspace to continue");
      return;
    }
    setPassword("");
    setStep("password");
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    if (!selectedWorkspace) {
      setStep("email");
      return;
    }
    try {
      await login(email.trim().toLowerCase(), password, {
        organizationId:
          selectedWorkspace.organizationId > 0 ? selectedWorkspace.organizationId : undefined,
      });
    } catch (err) {
      setError(errorMessage(err, "Invalid email or password"));
    }
  }

  async function handleRegisterAdmin(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();

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

  function showSocialNotice(provider: "Google") {
    setSocialNotice(
      `${provider} sign-in isn't connected yet. Continue with your work email.`,
    );
  }

  const title =
    mode === "admin"
      ? "Create your workspace"
      : mode === "forgot"
        ? "Reset password"
        : step === "workspaces"
          ? "We found your account"
          : step === "password"
            ? "Enter your password"
            : step === "missing"
              ? inactiveAccount
                ? "This account isn't active"
                : "We couldn't find your account"
              : step === "portal"
                ? (portalHint ? PORTAL_HINTS[portalHint].title : "Use a different sign-in")
                : "Welcome to AASO";

  const subtitle =
    mode === "admin"
      ? "Set up your company workspace and invite your team."
      : mode === "forgot"
        ? resetPhase === "password"
          ? "Choose a new password."
          : resetPhase === "code"
            ? "Enter the verification code from your email."
            : "Enter your email to get a verification code."
        : step === "workspaces"
          ? "Select your workspace to continue."
          : step === "password"
            ? "Secure login"
            : step === "missing"
              ? inactiveAccount
                ? "Ask your administrator to reactivate this account."
                : "No workspace is linked to this email."
              : step === "portal" && portalHint
                ? PORTAL_HINTS[portalHint].body
                : "The Operating System for Service Businesses";

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
          <div className="w-full min-w-0 max-w-[440px]">
            {mode === "login" ? <StepTracker step={trackerStep} /> : null}

            <div className="rounded-[28px] bg-white px-5 py-7 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:px-8 sm:py-9">
              {mode === "forgot" || (mode === "login" && step !== "email") ? (
                <button
                  type="button"
                  onClick={goToPrevious}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  <ArrowLeft size={16} />
                  Previous
                </button>
              ) : null}
              <div className="mb-6 text-center">
                {step === "password" && mode === "login" && selectedWorkspace ? (
                  <WorkspaceHeading
                    workspace={selectedWorkspace}
                    onNotYou={() => {
                      resetNotices();
                      setPassword("");
                      setStep("workspaces");
                    }}
                  />
                ) : (
                  <>
                    <h1 className="text-[1.65rem] font-bold tracking-tight text-[#111827]">{title}</h1>
                    <p className="mt-1.5 text-sm text-gray-500">{subtitle}</p>
                  </>
                )}
              </div>

              {mode === "login" && step === "email" ? (
                <form onSubmit={handleLookup} className="w-full min-w-0 space-y-4">
                  <Field label="Work email" htmlFor="email" icon={Mail}>
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
                  {error ? <p className="text-sm text-red-500">{error}</p> : null}
                  <PrimaryButton
                    busy={isLookingUpWorkspaces}
                    label="Continue"
                    busyLabel="Checking account..."
                    arrow
                  />
                  <OrDivider />
                  <div className="grid">
                    <SocialButton
                      provider="Google"
                      icon={<GoogleIcon />}
                      busy={googleBusy || isLookingUpWorkspaces}
                      onClick={handleGoogleSignIn}
                    />
                  </div>
                  {socialNotice ? (
                    <p className="text-center text-xs leading-relaxed text-gray-500">{socialNotice}</p>
                  ) : null}
                </form>
              ) : null}

              {mode === "login" && step === "workspaces" ? (
                <form onSubmit={handleChooseWorkspace} className="space-y-4">
                  <div className="space-y-2.5" role="radiogroup" aria-label="Workspaces">
                    {workspaces.map((workspace, index) => {
                      const selected = index === selectedIndex;
                      return (
                        <button
                          key={`${workspace.organizationId}-${workspace.roleLabel}-${index}`}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setSelectedIndex(index)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                            selected
                              ? "border-[#2563EB] bg-[#F8FBFF] ring-1 ring-[#2563EB]"
                              : "border-gray-200 bg-white hover:border-gray-300",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                              selected ? "border-[#2563EB]" : "border-gray-300",
                            )}
                          >
                            {selected ? <span className="h-2.5 w-2.5 rounded-full bg-[#2563EB]" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[#111827]">
                              {workspace.organizationName}
                            </span>
                            <span className="block truncate text-xs text-gray-500">{workspace.roleLabel}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {error ? <p className="text-sm text-red-500">{error}</p> : null}
                  <PrimaryButton busy={false} label="Continue" busyLabel="Continue" arrow />
                  <InfoNote
                    icon={ShieldCheck}
                    tone="blue"
                    title="Not seeing your workspace?"
                    body="Contact your administrator"
                  />
                </form>
              ) : null}

              {mode === "login" && step === "password" && selectedWorkspace ? (
                <form onSubmit={handleLogin} className="space-y-4">
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
                      onClick={() => {
                        setForgotFrom("password");
                        switchMode("forgot");
                      }}
                      className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                    >
                      Forgot password?
                    </button>
                  </div>
                  {error ? <p className="text-sm text-red-500">{error}</p> : null}
                  <PrimaryButton busy={isLoggingIn} label="Sign in" busyLabel="Signing in..." />
                  <InfoNote
                    icon={Lock}
                    tone="green"
                    title="Your data is secure with AASO."
                    body="We use industry standard encryption to keep your information safe."
                  />
                </form>
              ) : null}

              {mode === "login" && (step === "missing" || step === "portal") ? (
                <div className="space-y-4">
                  {step === "portal" && portalHint ? (
                    <Link
                      to={PORTAL_HINTS[portalHint].href}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                    >
                      {PORTAL_HINTS[portalHint].action}
                      <ArrowRight size={16} />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchMode("admin")}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                    >
                      Create your workspace
                      <ArrowRight size={16} />
                    </button>
                  )}
                  <InfoNote
                    icon={ShieldCheck}
                    tone="blue"
                    title="Not seeing your workspace?"
                    body="Contact your administrator"
                  />
                </div>
              ) : null}

              {mode === "forgot" ? (
                <ForgotPasswordForm
                  email={email}
                  onEmailChange={setEmail}
                  initialCode={openedFromResetLink ? resetCode : ""}
                  loginPath="/login"
                  inputClassName="pl-3.5"
                  onPhaseChange={setResetPhase}
                  onSuccess={() => {
                    setSuccess(null);
                    setMode("login");
                    setStep(selectedWorkspace ? "password" : "email");
                  }}
                />
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
                    <PasswordInput
                      id="admin-password"
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
                    <PasswordInput
                      id="admin-confirm"
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className={fieldClass}
                      required
                      minLength={8}
                    />
                  </Field>
                  {error ? <p className="text-sm text-red-500">{error}</p> : null}
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
            </div>

            {mode === "login" && step === "email" ? (
              <OtherUserPaths
                onCreateWorkspace={() => switchMode("admin")}
                onForgotPassword={() => {
                  setForgotFrom("email");
                  switchMode("forgot");
                }}
              />
            ) : null}
          </div>
        </div>

        <footer className="relative z-10 flex flex-col gap-2 px-5 py-4 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} AASO. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Privacy</span>
            <span>Terms</span>
            <span>Help</span>
            <Link to="/client/login" className="hover:text-[#2563EB]">
              Client portal
            </Link>
            <Link to="/admin/login" className="hover:text-[#2563EB]">
              Platform admin
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function OtherUserPaths({
  onCreateWorkspace,
  onForgotPassword,
}: {
  onCreateWorkspace: () => void;
  onForgotPassword: () => void;
}) {
  return (
    <div className="mt-5">
      <p className="mb-3 text-sm font-semibold text-[#111827]">Other User Paths</p>
      <div className="space-y-2.5">
        <PathRow
          icon={Users}
          iconClassName="bg-[#D1FAE5] text-[#10B981]"
          eyebrow="New to AASO?"
          title="Create your workspace"
          description="Set up your company and invite your team."
          onClick={onCreateWorkspace}
        />
        <PathRow
          icon={UserRound}
          iconClassName="bg-[#EDE9FE] text-[#7C3AED]"
          eyebrow="Client Portal"
          title="Access as a client"
          description="View projects, approvals, invoices and more."
          to="/client/login"
        />
        <PathRow
          icon={Lock}
          iconClassName="bg-[#FFE4E6] text-[#F43F5E]"
          eyebrow="Forgot Password?"
          title="Reset your password securely."
          titleClassName="font-medium text-gray-500"
          onClick={onForgotPassword}
        />
      </div>
    </div>
  );
}

function PathRow({
  icon: Icon,
  iconClassName,
  eyebrow,
  title,
  description,
  titleClassName,
  onClick,
  to,
}: {
  icon: typeof Users;
  iconClassName: string;
  eyebrow: string;
  title: string;
  description?: string;
  titleClassName?: string;
  onClick?: () => void;
  to?: string;
}) {
  const className =
    "flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-colors hover:bg-[#F8FAFC]";
  const content = (
    <>
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", iconClassName)}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-gray-500">{eyebrow}</span>
        <span className={cn("block text-sm font-semibold text-[#2563EB]", titleClassName)}>{title}</span>
        {description ? <span className="mt-0.5 block text-xs text-gray-500">{description}</span> : null}
      </span>
      <ChevronRight size={18} className="shrink-0 text-gray-300" />
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function StepTracker({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1 as const, title: "Sign In" },
    { n: 2 as const, title: "Check Account" },
    { n: 3 as const, title: "Enter Password" },
  ];
  const [shown, setShown] = useState(step);

  useEffect(() => {
    if (step === shown) return undefined;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setShown(step);
      return undefined;
    }
    const id = window.setTimeout(() => setShown(step), 520);
    return () => window.clearTimeout(id);
  }, [step, shown]);

  return (
    <ol
      className="mb-4 grid w-full grid-cols-[auto_minmax(1rem,1fr)_auto_minmax(1rem,1fr)_auto] items-center"
      aria-label="Sign-in steps"
    >
      {items.map((item, index) => {
        const active = shown === item.n;
        const done = shown > item.n;
        const connected = step > item.n;
        return (
          <li key={item.n} className="contents">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <span
                key={active ? `active-${item.n}` : `idle-${item.n}`}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-300",
                  active
                    ? "login-step-active bg-[#2563EB] text-white shadow-[0_0_0_4px_rgba(37,99,235,0.18)]"
                    : done
                      ? "bg-[#DBEAFE] text-[#2563EB]"
                      : "bg-white text-gray-400 ring-1 ring-gray-200",
                )}
                aria-current={active ? "step" : undefined}
              >
                {item.n}
              </span>
              <span
                className={cn(
                  "hidden text-xs font-medium transition-colors duration-300 sm:inline",
                  active ? "text-[#111827]" : done ? "text-[#1D4ED8]" : "text-gray-400",
                )}
              >
                {item.title}
              </span>
            </span>
            {index < items.length - 1 ? (
              <span
                className="relative mx-1.5 h-0.5 overflow-hidden rounded-full bg-gray-200 sm:mx-2.5"
                aria-hidden
              >
                <span
                  className={cn(
                    "absolute inset-0 origin-left bg-[#2563EB] transition-transform duration-500 ease-out motion-reduce:transition-none",
                    connected ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function WorkspaceHeading({
  workspace,
  onNotYou,
}: {
  workspace: WorkspaceChoice;
  onNotYou: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-left">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E8EEF9] text-base font-semibold text-[#2563EB]">
        {orgInitial(workspace.organizationName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[#111827]">
          {workspace.organizationName}
        </span>
        <span className="block truncate text-xs text-gray-500">{workspace.roleLabel}</span>
      </span>
      <button
        type="button"
        onClick={onNotYou}
        className="shrink-0 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
      >
        Not you?
      </button>
    </div>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 pt-1 text-[11px] font-medium tracking-[0.16em] text-gray-400">
      <span className="h-px flex-1 bg-gray-200" />
      OR
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

function SocialButton({
  provider,
  icon,
  onClick,
  busy = false,
}: {
  provider: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-[40px] items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white px-2 transition-colors hover:bg-gray-50 disabled:opacity-60"
    >
      {icon}
      <span className="text-left leading-tight flex items-center">
        <span className="block text-[13px] text-gray-500">Continue with Google</span>
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function InfoNote({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Lock;
  tone: "blue" | "green";
  title: string;
  body: string;
}) {
  const blue = tone === "blue";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl px-3.5 py-3",
        blue ? "bg-[#EFF6FF]" : "bg-[#F0FDF4]",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          blue ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#DCFCE7] text-[#16A34A]",
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-sm font-semibold text-[#111827]">{title}</span>
        <span className={cn("mt-0.5 block text-xs leading-relaxed", blue ? "font-medium text-[#2563EB]" : "text-gray-500")}>
          {body}
        </span>
      </span>
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
  arrow,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  busyLabel: string;
  arrow?: boolean;
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
          {arrow ? <ArrowRight size={16} /> : null}
        </>
      )}
    </button>
  );
}
