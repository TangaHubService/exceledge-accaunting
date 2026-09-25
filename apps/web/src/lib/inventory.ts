import type { InventoryMovement, InventoryMovementKind, InventoryValuationMethod } from "./types";

export const KIND_LABELS: Record<InventoryMovementKind, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Goods received",
  SALE: "Sale",
  CUSTOMER_RETURN: "Customer return",
  ADJUSTMENT_IN: "Adjustment (gain)",
  ADJUSTMENT_OUT: "Adjustment (loss)",
  DAMAGE: "Damaged",
  EXPIRED: "Expired",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

export const METHOD_LABELS: Record<InventoryValuationMethod, string> = {
  FIFO: "First in, first out",
  WEIGHTED_AVERAGE: "Weighted average",
  SPECIFIC_IDENTIFICATION: "Specific identification",
};

export const COST_SOURCE_LABELS: Record<InventoryMovement["costSource"], string> = {
  ERP: "Cost from Excel Edge",
  FIFO: "Oldest cost layers",
  AVERAGE: "Average cost",
  TRANSFER: "Cost it left the other branch at",
  OPENING: "Opening snapshot",
  UNCOSTED: "No cost available",
};

/** Movement filter groups shown as segments; values are passed straight to the API. */
export const KIND_GROUPS: Array<{ key: string; label: string; kinds: InventoryMovementKind[] }> = [
  { key: "received", label: "Received", kinds: ["PURCHASE", "OPENING", "CUSTOMER_RETURN"] },
  { key: "sold", label: "Sold", kinds: ["SALE"] },
  { key: "adjusted", label: "Adjusted & written off", kinds: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "EXPIRED"] },
  { key: "transfers", label: "Transfers", kinds: ["TRANSFER_IN", "TRANSFER_OUT"] },
];

/** Where the GL side of a movement stands. */
export function postingStatus(m: InventoryMovement): string {
  if (m.journalNumber) return m.journalNumber;
  if (m.kind === "SALE") return "With the sale";
  if (m.value === 0) return "No value to post";
  return "Not posted";
}
