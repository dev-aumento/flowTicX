import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  FileText,
  FolderKanban,
  FolderOpen,
  Headphones,
  Loader2,
  Lock,
  Mail,
  Megaphone,
  Receipt,
  Users,
} from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AASO_SITE_URL, BrandLogo } from "@/components/brand/BrandLogo";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { displayPlanEndedMessage } from "@/lib/plan-ended";
import { cn } from "@/lib/utils";

type Step = "credentials" | "workspaces" | "forgot" | "register";

type WorkspaceChoice = {
  organizationId: number;
  organizationName: string;
  roleLabel: string;
};

const WORKSPACE_MARKS = [
  { icon: Building2, className: "bg-[#2563EB]" },
  { icon: FolderKanban, className: "bg-[#F59E0B]" },
  { icon: Users, className: "bg-[#A855F7]" },
  { icon: Megaphone, className: "bg-[#F97316]" },
] as const;

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof TRPCClientError) return displayPlanEndedMessage(err.message) || fallback;
  if (err instanceof Error) return displayPlanEndedMessage(err.message) || fallback;
  return fallback;
}

export default function ClientLogin() {
  const {
    login,
    registerClient,
    lookupClientWorkspaces,
    isRegistering,
    isLoggingIn,
    isLookingUpClientWorkspaces,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const resetEmail = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const resetCode = searchParams.get("code")?.trim() ?? "";
  const openedFromResetLink = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail) && /^\d{6}$/.test(resetCode);

  const [step, setStep] = useState<Step>(openedFromResetLink ? "forgot" : "credentials");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(openedFromResetLink ? resetEmail : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [helpNote, setHelpNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [forgotFrom, setForgotFrom] = useState<"credentials" | "workspaces">("credentials");

  const selectedWorkspace = workspaces[selectedIndex] ?? null;

  function resetNotices() {
    setError(null);
    setSuccess(null);
  }

  function goToPrevious() {
    resetNotices();
    setPassword("");
    setConfirmPassword("");
    if (step === "forgot") {
      setStep(forgotFrom);
      return;
    }
    setStep("credentials");
  }

  async function handleCredentials(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    try {
      const normalized = email.trim().toLowerCase();
      const result = await lookupClientWorkspaces(normalized);
      if (result.workspaces.length === 0) {
        if (result.inactive) {
          setError("This account isn't active. Ask your administrator to reactivate it.");
          return;
        }
        if (result.portal === "finance") {
          setError("This email uses the finance portal. Sign in there instead.");
          return;
        }
        if (result.portal === "platform") {
          setError("This email uses platform admin. Sign in there instead.");
          return;
        }
        setError("No client workspace is linked to this email.");
        return;
      }
      setEmail(normalized);
      setPassword("");
      setWorkspaces(result.workspaces);
      setSelectedIndex(0);
      setStep("workspaces");
    } catch (err) {
      setError(errorMessage(err, "Unable to look up your workspace. Please try again."));
    }
  }

  async function handleChooseWorkspace(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    if (!selectedWorkspace) {
      setError("Select a workspace to continue");
      return;
    }
    if (!password.trim()) {
      setError("Enter your password");
      return;
    }
    try {
      await login(email, password, {
        portal: "client",
        organizationId:
          selectedWorkspace.organizationId > 0 ? selectedWorkspace.organizationId : undefined,
      });
    } catch (err) {
      setError(errorMessage(err, "Unable to sign in. Please try again."));
    }
  }

  async function handleRegister(event: React.FormEvent) {
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

  return (
    <div className="min-h-dvh bg-[#F3F5F7] text-gray-900 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
      <ClientBrandPanel />

      <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[440px] rounded-[28px] bg-white px-6 py-8 shadow-[0_16px_50px_rgba(15,23,42,0.08)] sm:px-9 sm:py-10">
          {step !== "credentials" ? (
            <button
              type="button"
              onClick={goToPrevious}
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
            >
              <ArrowLeft size={16} />
              Previous
            </button>
          ) : null}
          {step === "credentials" ? (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div className="mb-2 text-center">
                <h1 className="text-[1.65rem] font-bold tracking-tight text-[#111827]">
                  Welcome to your Portal
                </h1>
                <p className="mt-2 text-sm text-gray-500">Sign in to access your projects.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-email" className="text-sm font-medium text-gray-700">
                  Email
                </Label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <Input
                    id="client-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@client.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 rounded-xl border-gray-200 pl-10"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    resetNotices();
                    setForgotFrom("credentials");
                    setStep("forgot");
                  }}
                  className="text-sm font-medium text-[#22C55E] hover:text-[#16A34A]"
                >
                  Forgot password?
                </button>
              </div>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <GreenButton
                busy={isLookingUpClientWorkspaces}
                label="Continue"
                busyLabel="Checking account..."
              />
              <button
                type="button"
                onClick={() => setHelpNote((value) => !value)}
                className="flex w-full items-center justify-center gap-2 pt-1 text-sm text-gray-600"
              >
                <Headphones size={16} className="text-[#22C55E]" />
                Need help? <span className="font-medium text-[#22C55E]">Contact our team</span>
              </button>
              {helpNote ? (
                <p className="text-center text-xs leading-relaxed text-gray-500">
                  Ask your workspace administrator if you cannot sign in.
                </p>
              ) : null}
            </form>
          ) : null}

          {step === "workspaces" ? (
            <form onSubmit={handleChooseWorkspace} className="space-y-4">
              <div className="text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                  <Building2 size={26} />
                </span>
                <h1 className="mt-4 text-xl font-bold text-[#111827]">Choose your workspace</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {workspaces.length > 1
                    ? "Select a workspace and enter your password."
                    : "Enter your password to continue."}
                </p>
              </div>
              <div className="space-y-2.5">
                {workspaces.map((workspace, index) => {
                  const mark = WORKSPACE_MARKS[index % WORKSPACE_MARKS.length];
                  const Icon = mark.icon;
                  const selected = index === selectedIndex;
                  return (
                    <button
                      key={`${workspace.organizationId}-${workspace.roleLabel}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                        selected
                          ? "border-[#2563EB] bg-[#F8FBFF] ring-1 ring-[#2563EB]"
                          : "border-gray-200 bg-white hover:border-gray-300",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white",
                          mark.className,
                        )}
                      >
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#111827]">
                          {workspace.organizationName}
                        </span>
                        <span className="block truncate text-xs text-gray-500">{workspace.roleLabel}</span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-gray-300" />
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-password" className="text-sm font-medium text-gray-700">
                  Password
                </Label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-gray-400"
                  />
                  <PasswordInput
                    id="client-password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 rounded-xl border-gray-200 pl-10"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    resetNotices();
                    setForgotFrom("workspaces");
                    setStep("forgot");
                  }}
                  className="text-sm font-medium text-[#22C55E] hover:text-[#16A34A]"
                >
                  Forgot password?
                </button>
              </div>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <button
                type="submit"
                disabled={isLoggingIn}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          ) : null}

          {step === "forgot" ? (
            <ForgotPasswordForm
              email={email}
              onEmailChange={setEmail}
              initialCode={openedFromResetLink ? resetCode : ""}
              loginPath="/client/login"
              showHeading
              onSuccess={() => {
                setSuccess(null);
                setStep("credentials");
              }}
            />
          ) : null}

          {step === "register" ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="text-center">
                <h1 className="text-xl font-bold text-[#111827]">Create client workspace</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Manage projects, tasks, invoices, and invite your delivery team.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-password">Password</Label>
                <PasswordInput
                  id="register-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-confirm">Confirm password</Label>
                <PasswordInput
                  id="register-confirm"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                  minLength={8}
                />
              </div>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <GreenButton
                busy={isRegistering}
                label="Create client workspace"
                busyLabel="Creating workspace..."
              />
              <button
                type="button"
                onClick={() => {
                  resetNotices();
                  setStep("credentials");
                }}
                className="w-full text-sm text-gray-500"
              >
                Already have an account? Sign in
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const portalFeatures = [
  { label: "Project updates", icon: FileText },
  { label: "File sharing", icon: FolderOpen },
  { label: "Invoicing and payments", icon: Receipt },
] as const;

function ClientBrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#0C3B30] text-white lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-10 xl:px-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 18% 78%, rgba(52, 211, 153, 0.22) 0%, transparent 42%),
            radial-gradient(circle at 88% 12%, rgba(16, 185, 129, 0.16) 0%, transparent 36%)
          `,
        }}
      />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full border border-white/10" />
      <div className="pointer-events-none absolute -right-16 top-10 h-56 w-56 rounded-full border border-white/10" />

      <div className="relative z-10 flex items-center gap-3">
        <BrandLogo variant="dark" imgClassName="h-8" href={AASO_SITE_URL} />
        <span className="rounded-full border border-[#3DDC97] px-2.5 py-1 text-[11px] font-medium text-[#3DDC97]">
          Client Portal
        </span>
      </div>

      <div className="relative z-10 max-w-md py-10">
        <h2 className="text-[2.6rem] font-semibold leading-[1.05] tracking-tight xl:text-5xl">
          Your projects.
          <br />
          Always in view.
        </h2>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/75">
          Access project updates, approve work, download files, track invoices and collaborate with
          your team.
        </p>
        <ul className="mt-8 space-y-3">
          {portalFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.label} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-[#3DDC97]">
                  <Icon size={16} />
                </span>
                {feature.label}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-white/45">© {new Date().getFullYear()} AASO</p>
    </aside>
  );
}

function GreenButton({
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
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] text-[15px] font-semibold text-white hover:bg-[#16A34A] disabled:opacity-60"
    >
      {busy ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {busyLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}
