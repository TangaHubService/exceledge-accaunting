import type { Tone } from "../components/ui";
import type { ExpensePaymentMode, ExpenseStatus, RecurringFrequency } from "./types";

export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  APPROVED: { label: "Approved", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "negative" },
  POSTED: { label: "Posted", tone: "positive" },
  REVERSED: { label: "Reversed", tone: "neutral" },
};

export const PAYMENT_MODE_LABELS: Record<ExpensePaymentMode, string> = {
  IMMEDIATE: "Paid now",
  ON_ACCOUNT: "On account",
  REIMBURSEMENT: "Employee claim",
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};
