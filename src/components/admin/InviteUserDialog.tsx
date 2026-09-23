import { useEffect, useState } from "react";
import { Check, Link2, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Invite } from "@contracts/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type InviteKind = "employee" | "client";

export function InviteUserDialog({
  open,
  onOpenChange,
  kind,
  teammateLabel = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: InviteKind;
  teammateLabel?: boolean;
}) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!open) return;
    setInviteUrl("");
    setInviteEmail("");
    setInviteError(null);
    setCopied(false);
  }, [open, kind]);

  const createInviteMutation = trpc.invite.create.useMutation({
    onSuccess: (result) => {
      const url = result.url || `${window.location.origin}/invite/${result.token}`;
      setInviteUrl(url);
      setInviteError(null);
      setCopied(false);
      void utils.invite.list.invalidate();
    },
    onError: (err) => {
      setInviteError(err.message || "Failed to generate invite link. Please try again.");
    },
  });

  function handleGenerateInvite() {
    setInviteError(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    createInviteMutation.mutate({ email, kind });
  }

  async function handleCopyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const personLabel = kind === "client" ? "client" : teammateLabel ? "teammate" : "employee";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{kind === "client" ? "Invite client" : "Invite via link"}</DialogTitle>
          <DialogDescription>
            {kind === "client"
              ? "Enter the client's email, then generate a unique invite link. They join the client dashboard and can assign tasks to your team."
              : `Enter the ${personLabel}'s email, then generate a unique invite link. They join this workspace as an employee so you can assign them tasks.`}{" "}
            Each link is single-use and expires after {Invite.expiryDays} days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="inviteEmail">Email</Label>
            <Input
              id="inviteEmail"
              type="email"
              required
              placeholder="name@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label>Invite via link</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteUrl}
                placeholder={
                  createInviteMutation.isPending
                    ? "Generating link..."
                    : "Click Generate to create an invite link"
                }
                className="text-sm bg-gray-50 font-mono text-gray-700"
              />
              <Button
                type="button"
                onClick={() => void handleCopyLink()}
                disabled={!inviteUrl}
                className="shrink-0 gap-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {copied ? <Check size={14} /> : <Link2 size={14} />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            {inviteError ? (
              <p className="text-sm text-red-500">{inviteError}</p>
            ) : inviteUrl ? (
              <p className="text-xs text-gray-500">
                Link ready — copy and share it. Generate a new link for each person you invite.
              </p>
            ) : null}
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              onClick={handleGenerateInvite}
              disabled={createInviteMutation.isPending || !inviteEmail.trim()}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2"
            >
              {createInviteMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Link2 size={14} />
              )}
              {inviteUrl ? "Generate new link" : "Generate invite link"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
