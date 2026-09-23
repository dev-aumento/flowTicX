import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { cn } from "@/lib/utils";

type ModalBackdropProps = {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  /** Extra classes on the full-screen overlay (padding, z-index, etc.). */
  overlayClassName?: string;
};

/**
 * Full-viewport modal shell portaled to document.body.
 * Avoids `position: fixed` being clipped by transformed ancestors (e.g. Framer Motion page wrappers).
 */
export function ModalBackdrop({
  open,
  onClose,
  children,
  className,
  overlayClassName,
}: ModalBackdropProps) {
  useBodyScrollLock(open);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4",
            overlayClassName,
            className,
          )}
          onClick={onClose}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
