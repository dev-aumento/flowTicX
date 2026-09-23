import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Loader2, Upload, X } from "lucide-react";
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
  organizationName: "",
  logoDataUrl: null as string | null,
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

function readLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please upload an image file for the logo."));
      return;
    }
    if (file.size > 1024 * 1024) {
      reject(new Error("Logo must be 1MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the logo file."));
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      if (!raw) {
        reject(new Error("Could not read the logo file."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxSide = 640;
        const srcW = Math.max(1, img.naturalWidth || img.width || 1);
        const srcH = Math.max(1, img.naturalHeight || img.height || 1);
        const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(raw);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

export default function PlatformSettings() {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      organizationName: data.organizationName ?? "",
      logoDataUrl: data.logoDataUrl ?? null,
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
      form.organizationName.trim() !== saved.organizationName.trim() ||
      form.firstName.trim() !== saved.firstName.trim() ||
      form.lastName.trim() !== saved.lastName.trim() ||
      form.email.trim() !== saved.email.trim() ||
      form.phone.trim() !== saved.phone.trim() ||
      (form.logoDataUrl ?? null) !== (saved.logoDataUrl ?? null)
    );
  }, [form, saved]);

  const canSave =
    dirty &&
    form.organizationName.trim().length > 0 &&
    form.firstName.trim().length > 0 &&
    form.email.trim().length > 0;

  async function handleLogoChange(file: File | null) {
    if (!file) return;
    try {
      const logoDataUrl = await readLogoFile(file);
      setForm((prev) => ({ ...prev, logoDataUrl }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload logo");
    }
  }

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
          Branding and contact details for the Aaso master admin console.
        </p>
      </div>

      <form
        className="max-w-2xl space-y-6 rounded-2xl border border-[#E6E8EC] bg-white p-6 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          update.mutate({
            organizationName: form.organizationName.trim(),
            logoDataUrl: form.logoDataUrl,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
          });
        }}
      >
        <div className="space-y-2">
          <Label>Logo of the CRM</Label>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-28 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-[#D1D5DB] bg-[#F8FAFC] transition-colors hover:bg-[#F3F4F6] sm:w-56 dark:border-[#334155] dark:bg-[#1E293B] dark:hover:bg-[#1E293B]/80"
            >
              {form.logoDataUrl ? (
                <img
                  src={form.logoDataUrl}
                  alt="CRM logo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <>
                  <Upload size={22} className="text-[#9CA3AF]" />
                  <span className="px-3 text-center text-xs font-medium text-[#6B7280]">
                    Upload CRM logo
                  </span>
                </>
              )}
            </button>
            <div className="space-y-2 text-xs text-[#6B7280]">
              <p>Shown in the master admin console. PNG, JPG, or SVG. Max 1MB.</p>
              <p>Preferred size: 240 × 240 pixels.</p>
              {form.logoDataUrl ? (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, logoDataUrl: null }))}
                  className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700"
                >
                  <X size={14} />
                  Remove logo
                </button>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handleLogoChange(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="platform-org">Platform name</Label>
          <Input
            id="platform-org"
            value={form.organizationName}
            onChange={(event) => setForm((prev) => ({ ...prev, organizationName: event.target.value }))}
            className="h-11"
          />
        </div>

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
