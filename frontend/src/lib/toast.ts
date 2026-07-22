import { toast } from "sonner";

/**
 * Non-blocking replacement for `window.confirm`: an actionable toast with a
 * Confirm and a Cancel button. `onConfirm` runs only when the user clicks
 * Confirm. Used for destructive / irreversible actions (send, delete).
 */
export function confirmToast(opts: {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  toast(opts.title, {
    description: opts.description,
    duration: 12000,
    action: { label: opts.confirmLabel ?? "Confirm", onClick: opts.onConfirm },
    cancel: { label: "Cancel", onClick: () => {} },
  });
}
