import type { Tone } from "../components/ui";
import type { AssetStatus, DepreciationMethod, DisposalMethod } from "./types";

export const ASSET_STATUS: Record<AssetStatus, { label: string; tone: Tone }> = {
  REGISTERED: { label: "Registered", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "positive" },
  FULLY_DEPRECIATED: { label: "Fully depreciated", tone: "info" },
  DISPOSED: { label: "Disposed", tone: "negative" },
};

export const DEP_METHOD_LABELS: Record<DepreciationMethod, string> = {
  STRAIGHT_LINE: "Straight-line",
  REDUCING_BALANCE: "Reducing balance",
};

export const DISPOSAL_LABELS: Record<DisposalMethod, string> = {
  SALE: "Sale",
  SCRAP: "Scrap",
  DONATION: "Donation",
  THEFT: "Theft",
  DESTRUCTION: "Destruction",
  RETIREMENT: "Retirement",
};

export function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
