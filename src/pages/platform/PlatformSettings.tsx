import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SettingsExitBar() {
  return (
    <Link
      to="/platform"
      className="inline-flex items-center gap-1 text-sm font-medium text-[#2563EB] hover:underline"
    >
      <ArrowLeft size={14} />
      Back to dashboard
    </Link>
  );
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

export default function PlatformSettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.platform.settings.useQuery();
  const update = trpc.platform.updateSettings.useMutation({
    onSuccess: async (result) => {
      utils.platform.settings.setData(undefined, result);
      await utils.auth.me.invalidate();
      toast.success("Platform settings saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saved, setSaved] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!data) return;
    const next = {
      firstName: data.firstName ?? "",
      lastName: data.lastName ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
    };
    setForm(next);
    setSaved(next);
  }, [data]);

  const dirty = useMemo(() => {
    return (
      form.firstName.trim() !== saved.firstName.trim() ||
      form.lastName.trim() !== saved.lastName.trim() ||
      form.email.trim() !== saved.email.trim() ||
      form.phone.trim() !== saved.phone.trim()
    );
  }, [form, saved]);

  const canSave = dirty && form.firstName.trim().length > 0 && form.email.trim().length > 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <SettingsExitBar />
        <div className="flex items-center justify-center py-16 text-[#6B7280]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SettingsExitBar />
        <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
          Platform Settings
        </h1>
        <p className="text-sm text-[#6B7280]">
          Contact details for the Aaso master admin console.
        </p>
      </div>

      <form
        className="max-w-2xl space-y-6 rounded-2xl border border-[#E6E8EC] bg-white p-6 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          update.mutate({
            organizationName: data?.organizationName?.trim() || "Aaso",
            logoDataUrl: data?.logoDataUrl ?? null,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="platform-first-name">First name</Label>
            <Input
              id="platform-first-name"
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-last-name">Last name</Label>
            <Input
              id="platform-last-name"
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
              className="h-11"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="platform-email">Email</Label>
            <Input
              id="platform-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-phone">Mobile number</Label>
            <Input
              id="platform-phone"
              type="tel"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              className="h-11"
              placeholder="10-digit mobile number"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSave || update.isPending}
          className="inline-flex h-10 items-center rounded-xl bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {update.isPending ? "Saving..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}
