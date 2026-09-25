import type { SelectOption } from "../components/Select";
import type { Tone } from "../components/ui";
import { amount } from "./format";
import { useResource, useSession } from "./session";
import type { BankTransaction, BankTransactionKind, FinancialAccount, FinancialAccountKind, ReconciliationStatus, StatementLineKind, TransferType } from "./types";

export const ACCOUNT_KIND_LABELS: Record<FinancialAccountKind, string> = {
  BANK: "Bank",
  CASH: "Cash",
  PETTY_CASH: "Petty cash",
  MOBILE_MONEY: "Mobile money",
};

export const ACCOUNT_KIND_ORDER: FinancialAccountKind[] = ["BANK", "MOBILE_MONEY", "CASH", "PETTY_CASH"];

export const TXN_KIND_LABELS: Record<BankTransactionKind, string> = {
  RECEIPT: "Money received",
  PAYMENT: "Payment",
  TRANSFER: "Transfer",
  BANK_CHARGE: "Bank charge",
  INTEREST: "Interest",
  CASH_COUNT: "Cash count",
};

export const TRANSFER_LABELS: Record<TransferType, string> = {
  DEPOSIT: "Cash deposited",
  WITHDRAWAL: "Cash withdrawn",
  REPLENISHMENT: "Petty cash top-up",
  TRANSFER: "Transfer",
};

export const LINE_KIND_LABELS: Record<StatementLineKind, string> = {
  BANK_CHARGE: "Bank charge",
  INTEREST: "Interest earned",
  OTHER: "Other item",
};

export const RECON_STATUS: Record<ReconciliationStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  REVIEWED: { label: "Reviewed", tone: "info" },
  APPROVED: { label: "Approved", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "positive" },
};

export const BANK_METHODS: SelectOption[] = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "EFT", label: "EFT" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

/** Bank and mobile money accounts are the ones with a statement to reconcile. */
export const hasStatement = (kind: FinancialAccountKind) => kind === "BANK" || kind === "MOBILE_MONEY";
export const isCash = (kind: FinancialAccountKind) => kind === "CASH" || kind === "PETTY_CASH";

export function accountSubtitle(a: Pick<FinancialAccount, "kind" | "bankName" | "accountNumber" | "provider" | "custodian">) {
  const parts =
    a.kind === "BANK"
      ? [a.bankName, a.accountNumber]
      : a.kind === "MOBILE_MONEY"
        ? [a.provider, a.accountNumber]
        : [a.custodian && `Held by ${a.custodian}`];
  return [ACCOUNT_KIND_LABELS[a.kind], ...parts].filter(Boolean).join(" · ");
}

export function txnLabel(t: Pick<BankTransaction, "kind" | "transferType">) {
  return t.kind === "TRANSFER" && t.transferType ? TRANSFER_LABELS[t.transferType] : TXN_KIND_LABELS[t.kind];
}

/** Signed effect of a transaction on the account it's listed under. */
export function txnEffect(t: BankTransaction, accountId?: string) {
  if (t.kind === "RECEIPT" || t.kind === "INTEREST") return t.amount;
  if (t.kind === "PAYMENT" || t.kind === "BANK_CHARGE") return -t.amount;
  if (t.kind === "TRANSFER") return accountId && t.counterAccountId === accountId ? t.amount : -(t.amount + t.fee);
  if (t.countedAmount !== null && t.bookAmount !== null) return t.countedAmount - t.bookAmount;
  return 0;
}

export function useFinancialAccounts(includeInactive = false) {
  const { can } = useSession();
  return useResource<FinancialAccount[]>(can("bank:view") ? `/api/v1/banking/accounts${includeInactive ? "?all=1" : ""}` : null);
}

export function financialAccountOptions(accounts: FinancialAccount[], filter: (a: FinancialAccount) => boolean = () => true): SelectOption[] {
  return ACCOUNT_KIND_ORDER.flatMap((kind) =>
    accounts
      .filter((a) => a.kind === kind && a.isActive && filter(a))
      .map((a) => ({ value: a.id, label: a.name, hint: amount(a.balance), group: ACCOUNT_KIND_LABELS[kind] })),
  );
}
