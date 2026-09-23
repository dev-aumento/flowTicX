import { TRPCClientError } from "@trpc/client";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { OrgAuthShell } from "@/components/auth/OrgAuthShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { writeAuthCache } from "@/lib/auth-cache";
import { getDefaultHomePath } from "@/lib/permissions";

type Step = "email" | "account";

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: validation, isLoading: validating } = trpc.invite.validate.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false },
  );

  useEffect(() => {
    if (validation?.valid && validation.email) {
      setEmail(validation.email);
    }
  }, [validation?.valid, validation?.email]);

  const emailLocked = Boolean(validation?.email);

  const acceptMutation = trpc.invite.accept.useMutation({
    onSuccess: async (result) => {
      writeAuthCache(result.user);
      utils.auth.me.setData(undefined, result.user);
      await utils.invalidate();
      navigate(getDefaultHomePath(result.user), { replace: true });
    },
  });

  const orgLabel = useMemo(() => {
    if (validation?.organizationName) {
      return typeof window !== "undefined"
        ? `${validation.organizationName.toLowerCase().replace(/\s+/g, "-")}.${window.location.host}`
        : validation.organizationName;
    }
    return undefined;
  }, [validation?.organizationName]);

  function handleContinueEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    if (!agreedToTerms) {
      setError("Please accept the Terms of Use to continue");
      return;
    }

    setStep("account");
  }

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Invalid invite link");
      return;
    }

    if (!name.trim()) {
      setError("Please enter your full name");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    try {
      await acceptMutation.mutateAsync({
        token,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
    } catch (err) {
      const message =
        err instanceof TRPCClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to create account. Please try again.";
      setError(message);
    }
  }

  if (!token) {
    return (
      <InvalidInvite
        message="This invite link is invalid."
        organizationLabel={orgLabel}
      />
    );
  }

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#e8ecf1]">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!validation?.valid) {
    return (
      <InvalidInvite
        message={
          validation?.expired
            ? "This invite link has expired. Please ask your administrator for a new one."
            : "This invite link is invalid or has already been used."
        }
        organizationLabel={orgLabel}
      />
    );
  }

  return (
    <OrgAuthShell organizationLabel={orgLabel}>
      {validation.invitedByName ? (
        <p className="text-center text-sm text-gray-500 -mt-4 mb-2">
          Invited by <span className="font-medium text-gray-700">{validation.invitedByName}</span>
        </p>
      ) : null}
      <p className="text-center text-xs text-gray-400 mb-6">
        {validation.inviteKind === "client"
          ? "You will join as a client, open the client dashboard, and can assign tasks to the team."
          : validation.clientWorkspace
          ? "You will join this client workspace and open the client portal dashboard."
          : "You will join this workspace as an employee and can be assigned tasks."}
      </p>

      {step === "email" ? (
        <form onSubmit={handleContinueEmail} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => {
                if (!emailLocked) setEmail(e.target.value);
              }}
              readOnly={emailLocked}
              className={`h-11 border-gray-200 text-[15px] ${
                emailLocked ? "bg-gray-50 text-gray-700" : "bg-white"
              }`}
              required
            />
            {emailLocked ? (
              <p className="text-xs text-gray-400">This invite is for this email address only.</p>
            ) : null}
          </div>

          <label className="flex items-start gap-3 cursor-pointer group">
            <Checkbox
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-600 leading-snug group-hover:text-gray-800">
              I agree to the Terms of Use and Privacy Policy
            </span>
          </label>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <button
            type="submit"
            className="w-full h-11 rounded-lg bg-[#3dd598] hover:bg-[#32c484] text-gray-900 font-semibold text-[15px] transition-colors shadow-sm"
          >
            Continue
          </button>

          <p className="text-center text-sm text-gray-500 pt-1">
            Already have an account?{" "}
            <Link
              to={
                validation.inviteKind === "client" || validation.clientWorkspace
                  ? "/client/login"
                  : "/login"
              }
              className="text-[#2563EB] hover:underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleCreateAccount} className="space-y-5">
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 -mt-2 mb-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600">
            {email}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium text-gray-700">
              Full name
            </Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
              Confirm password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 border-gray-200 bg-white text-[15px]"
              required
              minLength={8}
            />
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <button
            type="submit"
            disabled={acceptMutation.isPending}
            className="w-full h-11 rounded-lg bg-[#3dd598] hover:bg-[#32c484] disabled:opacity-60 text-gray-900 font-semibold text-[15px] transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            {acceptMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating account...
              </>
            ) : (
              "Continue"
            )}
          </button>

          <p className="text-center text-xs text-gray-400 leading-relaxed">
            By continuing you confirm that you accept the Terms of Use and Privacy Policy.
          </p>
        </form>
      )}

      <div className="mt-8 pt-6 border-t border-gray-100">
        <p className="text-center text-xs text-gray-400 mb-3">Other login options</p>
        <div className="flex items-center justify-center">
          <Link
            to={
              validation.inviteKind === "client" || validation.clientWorkspace
                ? "/client/login"
                : "/login"
            }
            className="text-sm font-medium text-[#2563EB] hover:underline"
          >
            Sign in with existing account
          </Link>
        </div>
      </div>
    </OrgAuthShell>
  );
}

function InvalidInvite({
  message,
  organizationLabel,
}: {
  message: string;
  organizationLabel?: string;
}) {
  return (
    <OrgAuthShell organizationLabel={organizationLabel}>
      <div className="text-center space-y-4 py-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
          <AlertCircle size={24} className="text-red-500" />
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
        <Link
          to="/login"
          className="inline-flex w-full h-11 items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Go to sign in
        </Link>
      </div>
    </OrgAuthShell>
  );
}
