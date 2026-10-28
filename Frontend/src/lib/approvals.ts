import type { Tone } from "../components/ui";
import type { Journal } from "./types";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "RETURNED";
export type ApprovalEntityType = "Journal" | "Expense" | "ApBill" | "Budget" | "TaxAdjustment" | "FixedAssetImpairment" | "PeriodClose";

export type ApprovalDecision = {
  id: string;
  level: number;
  decision: "APPROVED" | "REJECTED" | "RETURNED" | "RESUBMITTED";
  erpUserId: number;
  erpRole: string | null;
  note: string | null;
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  entityType: ApprovalEntityType | string;
  entityId: string;
  amount: string | number;
  status: ApprovalStatus;
  reason: string | null;
  requestedByErpUserId: number | null;
  requiredLevels: number;
  approvedLevels: number;
  levelRoles: string[];
  nextRole: string | null;
  decisions: ApprovalDecision[];
  summary: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByErpUserId: number | null;
};

export type ApprovalRequirement = {
  required: boolean;
  levels: number;
  roles: Array<string | null>;
  reasons: string[];
  requireDifferentPoster: boolean;
  supportingDocumentRequired: boolean;
};

export type JournalLineDetail = Journal["lines"][number] & { costCentre?: string | null; project?: string | null; branchId?: string | null };

export type JournalDetail = Omit<Journal, "lines"> & {
  lines: JournalLineDetail[];
  approval?: ApprovalRequest | null;
  exchangeRate?: string | number | null;
  branchId?: string | null;
  createdByErpUserId?: number | null;
  approvedByErpUserId?: number | null;
  postedByErpUserId?: number | null;
};

export type Dimension = { id: string; kind: "COST_CENTRE" | "PROJECT"; code: string; name: string; isActive: boolean };

export type SupportingDocument = { id: string; entityType: string; entityId: string; fileName: string; note: string | null; createdAt?: string; uploadedByErpUserId?: number | null };

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  createdAt: string;
  targetRole: string | null;
  targetErpUserId: number | null;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  readAt: string | null;
};

export const APPROVAL_TONE: Record<ApprovalStatus, Tone> = { PENDING: "warning", APPROVED: "positive", REJECTED: "negative", RETURNED: "info" };

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", RETURNED: "Returned for correction" };

export const DECISION_LABEL: Record<ApprovalDecision["decision"], string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for correction",
  RESUBMITTED: "Resubmitted",
};

const ENTITY_LABEL: Record<string, string> = {
  Journal: "Journal entry",
  Expense: "Expense",
  ApBill: "Supplier bill",
  Budget: "Budget",
  TaxAdjustment: "Tax adjustment",
  FixedAssetImpairment: "Asset impairment",
  PeriodClose: "Period close",
};

export function entityTypeLabel(type: string | null | undefined) {
  if (!type) return "";
  return ENTITY_LABEL[type] ?? type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Where to open a record referenced by an approval, notification or audit event. */
export function entityHref(type: string | null | undefined, id: string | null | undefined): string | null {
  if (!type) return null;
  switch (type) {
    case "Journal":
      return id ? `/journals?id=${id}` : "/journals";
    case "ApprovalRequest":
      return id ? `/approvals?id=${id}` : "/approvals";
    case "Expense":
      return "/expenses/list";
    case "ApBill":
      return "/bills";
    case "Budget":
    case "BudgetLine":
      return "/budgets";
    case "PeriodClose":
    case "AccountingPeriod":
      return "/close";
    default:
      return null;
  }
}

export function roleLabel(role: string | null | undefined) {
  if (!role) return "Any approver";
  const s = role.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Announces read-state changes so the shell badge can refresh. */
export const NOTIFICATIONS_CHANGED = "accounting:notifications-changed";
