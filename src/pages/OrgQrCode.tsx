import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  QrCode,
  RefreshCw,
} from "lucide-react";
import QRCode from "qrcode";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { canManageAttendance } from "@/lib/leave-policy";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function activityLabel(action: "created" | "regenerated" | "downloaded") {
  if (action === "created") return "created the QR code";
  if (action === "regenerated") return "regenerated the QR code";
  return "downloaded the QR code";
}

export default function OrgQrCodePage() {
  const { user } = useAuth();
  const allowed = canManageAttendance(user);
  const utils = trpc.useUtils();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rendering, setRendering] = useState(false);

  const { data: qr, isLoading } = trpc.orgQr.get.useQuery(undefined, {
    enabled: allowed,
  });

  const { data: activity = [], isLoading: activityLoading } =
    trpc.orgQr.listActivity.useQuery(undefined, { enabled: allowed });

  const invalidateQrViews = async () => {
    await Promise.all([
      utils.orgQr.get.invalidate(),
      utils.orgQr.listActivity.invalidate(),
    ]);
  };

  const generateMutation = trpc.orgQr.generate.useMutation({
    onSuccess: async () => {
      await invalidateQrViews();
    },
  });

  const regenerateMutation = trpc.orgQr.regenerate.useMutation({
    onSuccess: async () => {
      await invalidateQrViews();
      setConfirmOpen(false);
    },
  });

  const recordDownloadMutation = trpc.orgQr.recordDownload.useMutation({
    onSuccess: async () => {
      await utils.orgQr.listActivity.invalidate();
    },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !qr?.payload) return;

    let cancelled = false;
    setRendering(true);
    void QRCode.toCanvas(canvas, qr.payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then(() => {
        if (!cancelled) setRendering(false);
      })
      .catch(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [qr?.payload]);

  const downloadPng = useCallback(async () => {
    if (!qr?.payload) return;
    try {
      const dataUrl = await QRCode.toDataURL(qr.payload, {
        width: 1024,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `attendance-qr-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      recordDownloadMutation.mutate();
    } catch {
      // Keep silent — no toast for QR actions.
    }
  }, [qr?.payload, recordDownloadMutation.mutate]);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const busy =
    generateMutation.isPending ||
    regenerateMutation.isPending ||
    isLoading;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2 text-[#1F2937]">
            <QrCode className="h-6 w-6 text-[#2563EB]" />
            <h1 className="text-2xl font-bold tracking-tight">QR Code</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500 max-w-xl">
            Generate a downloadable attendance QR for your workplace. Only HR
            and admin can view or regenerate it. Regenerating invalidates older
            downloads.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8 shadow-sm"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading QR…
          </div>
        ) : !qr ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-2xl bg-blue-50 p-4 text-[#2563EB]">
              <QrCode className="h-10 w-10" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1F2937]">
                No QR code yet
              </h2>
              <p className="mt-1 text-sm text-gray-500 max-w-sm">
                Create a random workplace QR code you can download.
              </p>
            </div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => generateMutation.mutate()}
              className="bg-[#2563EB] hover:bg-[#1D4ED8]"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4" />
              )}
              Generate QR code
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="relative rounded-2xl border border-gray-100 bg-white p-4 shadow-inner">
              {rendering && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/80">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              )}
              <canvas
                ref={canvasRef}
                className="h-[280px] w-[280px]"
                aria-label="Attendance QR code"
              />
            </div>

            <p className="text-xs text-gray-500">
              Last updated{" "}
              {formatWorkZoneDateTime(new Date(qr.updatedAt))}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void downloadPng()}
              >
                <Download className="h-4 w-4" />
                Download PNG
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
                className="border-amber-200 text-amber-800 hover:bg-amber-50"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-[#1F2937]">Activity</h2>
        <p className="mt-1 text-xs text-gray-500">
          Who created, regenerated, or downloaded this QR code.
        </p>

        {activityLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading activity…
          </div>
        ) : activity.length === 0 ? (
          <p className="py-8 text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {activity.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm text-gray-700">
                  <span className="font-medium text-[#1F2937]">
                    {item.userName}
                  </span>{" "}
                  {activityLabel(item.action)}
                </p>
                <p className="text-xs text-gray-400 shrink-0">
                  {formatWorkZoneDateTime(new Date(item.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate QR code?</DialogTitle>
            <DialogDescription>
              A new random code will replace the current one. Any downloads
              with the old QR will stop working once scanning is enforced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={regenerateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              className="bg-[#2563EB] hover:bg-[#1D4ED8]"
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
