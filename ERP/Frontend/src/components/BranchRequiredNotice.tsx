import { AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";

interface BranchRequiredNoticeProps {
  message?: string;
  className?: string;
}

/** Inline warning shown wherever an operation requires a specific branch (not "All Branches") to be selected in the header before it can proceed. */
export function BranchRequiredNotice({ message, className }: BranchRequiredNoticeProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="text-sm text-amber-800 dark:text-amber-300">
        {message ?? 'Select a specific branch from the header (not "All Branches") to continue.'}
      </p>
    </div>
  );
}
