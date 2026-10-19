import { TRPCClientError } from "@trpc/client";
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { Loader2, Timer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

function errorMessage(err: unknown) {
  if (err instanceof TRPCClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unable to sign in. Please try again.";
}

export default function ProjectPulseLogin() {
  const { user, isLoading, login, isLoggingIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F1EC]">
        <Loader2 className="animate-spin text-[#E85D04]" />
      </div>
    );
  }
  if (user) return <Navigate to="/projectpulse" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    sessionStorage.setItem("auth-redirect", "/projectpulse");
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      sessionStorage.removeItem("auth-redirect");
      setError(errorMessage(err));
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F1EC] text-[#1C1917]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#2563EB] text-white">
            <Timer size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ProjectPulse</h1>
            <p className="text-sm text-[#78716C]">Time tracking for AASO projects and tasks</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-[#E7E2DA] bg-white p-6 shadow-sm">
          <p className="text-sm leading-6 text-[#57534E]">
            Sign in with your AASO account. Hours you track here are saved on the project and task, the same way Harvest records time against an Asana task.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="pulse-email">Work email</Label>
              <Input
                id="pulse-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <Label htmlFor="pulse-password">Password</Label>
              <PasswordInput
                id="pulse-password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={isLoggingIn}
            className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-[#2563EB] text-sm font-semibold text-white disabled:opacity-60"
          >
            {isLoggingIn ? <Loader2 size={16} className="animate-spin" /> : "Sign in to ProjectPulse"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[#78716C]">
          <Link to="/login" className="font-medium text-[#1C1917] underline-offset-2 hover:underline">
            Back to AASO
          </Link>
        </p>
      </div>
    </div>
  );
}
