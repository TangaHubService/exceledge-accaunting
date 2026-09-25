import type { Tone } from "../components/ui";
import type { TaxFilingKind, TaxFilingStatus, TaxType } from "./types";

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  OUTPUT_VAT: "Output VAT",
  INPUT_VAT: "Input VAT",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
  WHT_PAYABLE: "Withholding payable",
  WHT_RECEIVABLE: "Withholding receivable",
  EXCISE: "Excise",
  IMPORT_VAT: "Import VAT",
  PAYE: "PAYE",
  OTHER: "Other",
};

export const FILING_KIND_LABELS: Record<TaxFilingKind, string> = {
  VAT: "VAT return",
  WHT: "Withholding tax",
  PAYE: "PAYE",
  EXCISE: "Excise",
  ANNUAL: "Annual return",
};

export const FILING_STATUS: Record<TaxFilingStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PREPARED: { label: "Prepared", tone: "info" },
  FILED: { label: "Filed", tone: "positive" },
};

/** Types you can settle with a tax payment from the bank. */
export const PAYABLE_TAX_TYPES: TaxType[] = ["OUTPUT_VAT", "INPUT_VAT", "WHT_PAYABLE", "PAYE", "EXCISE", "IMPORT_VAT", "OTHER"];

export const FILING_KINDS: TaxFilingKind[] = ["VAT", "WHT", "PAYE", "EXCISE", "ANNUAL"];
