import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Building2,
  Check,
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
  ShieldCheck,
  Users,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { writeAuthCache } from "@/lib/auth-cache";
import { displayPlanEndedMessage } from "@/lib/plan-ended";
import { getDefaultHomePath } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Step = "credentials" | "workspaces" | "code" | "success" | "forgot" | "register";

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
  const navigate = useNavigate();
  const {
    registerClient,
    resetPassword,
    beginClientLogin,
    sendClientLoginCode,
    resendClientLoginCode,
    verifyClientLogin,
    isRegistering,
    isResettingPassword,
    isBeginningClientLogin,
    isSendingClientCode,
    isVerifyingClientLogin,
  } = useAuth();

  const [step, setStep] = useState<Step>("credentials");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [helpNote, setHelpNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedWorkspace = workspaces[selectedIndex] ?? null;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function resetNotices() {
    setError(null);
    setSuccess(null);
  }

  async function handleCredentials(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    try {
      const result = await beginClientLogin(email.trim().toLowerCase(), password);
      setEmail(email.trim().toLowerCase());
      setTicket(result.ticket);
      setWorkspaces(result.workspaces);
      setSelectedIndex(0);
      setCode("");
      setPreviewCode(null);
      setStep("workspaces");
    } catch (err) {
      setError(errorMessage(err, "Unable to sign in. Please try again."));
    }
  }

  async function handleChooseWorkspace(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    if (!ticket || !selectedWorkspace) {
      setError("Select a workspace to continue");
      return;
    }
    try {
      const result = await sendClientLoginCode(ticket, selectedWorkspace.organizationId);
      setChallengeId(result.challengeId);
      setPreviewCode(result.previewCode ?? null);
      setCode("");
      setResendIn(result.resendInSeconds);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err, "Unable to send the sign-in code."));
    }
  }

  async function handleResend() {
    if (!challengeId || resendIn > 0 || isSendingClientCode) return;
    resetNotices();
    try {
      const result = await resendClientLoginCode(challengeId);
      setChallengeId(result.challengeId);
      setPreviewCode(result.previewCode ?? null);
      setCode("");
      setResendIn(result.resendInSeconds);
    } catch (err) {
      setError(errorMessage(err, "Unable to resend the code."));
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
    if (!challengeId || code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    try {
      const result = await verifyClientLogin(challengeId, code);
      setStep("success");
      window.setTimeout(() => {
        writeAuthCache(result.user);
        navigate(getDefaultHomePath(result.user), { replace: true });
      }, 1400);
    } catch (err) {
      setError(errorMessage(err, "That code is incorrect."));
    }
  }

  async function handleForgotPassword(event: React.FormEvent) {
    event.preventDefault();
    resetNotices();
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
        setSuccess(null);
        setStep("credentials");
      }, 1500);
    } catch (err) {
      setError(errorMessage(err, "Unable to update password. Please try again."));
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
                    setStep("forgot");
                  }}
                  className="text-sm font-medium text-[#22C55E] hover:text-[#16A34A]"
                >
                  Forgot password?
                </button>
              </div>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <GreenButton busy={isBeginningClientLogin} label="Sign in" busyLabel="Checking account..." />
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
                    ? "You have access to multiple workspaces. Select one to continue."
                    : "Select your workspace to continue."}
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
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <button
                type="submit"
                disabled={isSendingClientCode}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {isSendingClientCode ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          ) : null}

          {step === "code" ? (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#DBEAFE] text-[#2563EB]">
                  <ShieldCheck size={26} />
                </span>
                <h1 className="mt-4 text-xl font-bold text-[#111827]">Verify it&apos;s you</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Enter the 6 digit code sent to
                  <br />
                  <span className="font-medium text-[#111827]">{email}</span>
                </p>
              </div>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-12 w-11 rounded-lg border border-gray-200 text-lg first:rounded-lg first:border-l last:rounded-lg"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {previewCode ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs leading-relaxed text-amber-800">
                  Outgoing email is not configured on this server yet, so the code is shown here:{" "}
                  <span className="font-semibold tracking-widest">{previewCode}</span>
                </p>
              ) : null}
              <p className="text-center text-sm text-gray-500">
                Didn&apos;t receive the code?{" "}
                {resendIn > 0 ? (
                  <span className="font-medium text-[#2563EB]">Resend in {resendIn}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isSendingClientCode}
                    className="font-medium text-[#2563EB] disabled:opacity-60"
                  >
                    Resend
                  </button>
                )}
              </p>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              <button
                type="submit"
                disabled={isVerifyingClientLogin || code.length !== 6}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-[#2563EB] text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {isVerifyingClientLogin ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetNotices();
                  setCode("");
                  setStep("credentials");
                }}
                className="w-full text-sm font-medium text-[#2563EB]"
              >
                Use a different method
              </button>
            </form>
          ) : null}

          {step === "success" ? (
            <div className="py-6 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#DCFCE7] text-[#16A34A]">
                <Check size={32} strokeWidth={2.5} />
              </span>
              <h1 className="mt-5 text-xl font-bold text-[#111827]">Welcome back!</h1>
              <p className="mt-1 text-sm text-gray-500">Redirecting you to your dashboard...</p>
              <div className="mt-8 flex flex-col items-center gap-2 text-sm text-gray-500">
                <Loader2 size={22} className="animate-spin text-[#2563EB]" />
                <p className="font-medium text-[#111827]">Setting up your workspace</p>
                <p className="text-xs">This will only take a moment.</p>
              </div>
            </div>
          ) : null}

          {step === "forgot" ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="text-center">
                <h1 className="text-xl font-bold text-[#111827]">Reset password</h1>
                <p className="mt-1 text-sm text-gray-500">Enter a new password for your client account.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-password">New password</Label>
                <PasswordInput
                  id="forgot-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-confirm">Confirm password</Label>
                <PasswordInput
                  id="forgot-confirm"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="h-11 rounded-xl"
                  required
                  minLength={8}
                />
              </div>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
              {success ? <p className="text-sm text-green-600">{success}</p> : null}
              <GreenButton
                busy={isResettingPassword}
                disabled={!!success}
                label="Update password"
                busyLabel="Updating password..."
              />
              <button
                type="button"
                onClick={() => {
                  resetNotices();
                  setStep("credentials");
                }}
                className="w-full text-sm text-gray-500"
              >
                Back to sign in
              </button>
            </form>
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
        <BrandLogo variant="dark" imgClassName="h-8" />
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
