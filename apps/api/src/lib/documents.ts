import { computeDocumentLines, roundMoney, type DefaultAccountMap, type DocumentLineInput } from "@exceledge/accounting-domain";
import { ensureDefaultAccountMappings } from "../modules/setup/setup.service";
import { allocateNumber } from "./numbering";
import { prisma } from "./prisma";

export function money(value: { toString(): string } | number | null | undefined) {
  return roundMoney(Number(value ?? 0));
}

/** Next document number for the company's sequence, e.g. BILL-2026-000001. */
export async function nextNumber(companyId: string, documentType: string, prefix: string, opts: { date?: Date; branchId?: string | null } = {}) {
  return allocateNumber(companyId, documentType, prefix, opts);
}

/** Schema default for party and bank-account currencies, so a stored "RWF" may only be that default. */
const DEFAULT_CURRENCY = "RWF";

/** The currency a party or bank account was really given; undefined when unset or only defaulted (post in functional). */
export function explicitCurrency(value?: string | null) {
  const code = value?.trim().toUpperCase();
  return code && code !== DEFAULT_CURRENCY ? code : undefined;
}

/** Functional currency for the company (or the schema default when unset). */
export async function functionalCurrencyOf(companyId: string) {
  const settings = await prisma.currencySettings.findUnique({ where: { companyId } });
  return settings?.functionalCurrency?.toUpperCase() ?? DEFAULT_CURRENCY;
}

/**
 * Currency and rate for an AR/AP document. The document currency defaults to the party's, then the
 * functional currency. A party with an explicit currency cannot be billed in another. Foreign rates
 * come from the request or the latest exchange rate on or before the document date.
 */
export async function resolveDocumentMoney(
  companyId: string,
  input: { documentCurrency?: string | null; partyCurrency?: string | null; date: Date; rate?: number | null },
) {
  const functional = await functionalCurrencyOf(companyId);
  const party = explicitCurrency(input.partyCurrency);
  const document = input.documentCurrency?.trim().toUpperCase() || undefined;
  if (party && document && party !== document) {
    throw new Error(`This party is in ${party}; the document cannot be in ${document}`);
  }
  const currency = document ?? party ?? functional;
  if (currency === functional) return { functional, currency, rate: 1 };
  let rate = input.rate;
  if (rate == null) {
    const row = await prisma.exchangeRate.findFirst({
      where: { companyId, currency, rateDate: { lte: input.date } },
      orderBy: { rateDate: "desc" },
    });
    if (!row) throw new Error(`No exchange rate for ${currency} on or before ${input.date.toISOString().slice(0, 10)}`);
    rate = Number(row.rate);
  }
  if (!(rate > 0)) throw new Error("Exchange rate must be greater than zero");
  return { functional, currency, rate: Math.round(rate * 1e8) / 1e8 };
}

/** Banking and other paths that are still functional-currency only until they use resolveDocumentMoney. */
export async function assertFunctionalDocument(companyId: string, document?: string | null, party?: string | null) {
  const functional = await functionalCurrencyOf(companyId);
  const foreign = [document?.trim().toUpperCase(), explicitCurrency(party)].find((c) => c && c !== functional);
  if (foreign) throw new Error(`Documents in ${foreign} are not supported yet; the company's functional currency is ${functional}`);
  return functional;
}

/** FX gain and loss accounts from currency settings, falling back to the default posting accounts. */
export async function fxAccounts(companyId: string) {
  const [settings, defaults] = await Promise.all([
    prisma.currencySettings.findUnique({ where: { companyId } }),
    defaultsFor(companyId),
  ]);
  const gainId = settings?.fxGainAccountId ?? defaults.fxGainId;
  const lossId = settings?.fxLossAccountId ?? defaults.fxLossId;
  if (!gainId || !lossId) throw new Error("FX gain and loss accounts must be set before posting foreign-currency settlements");
  return { gainId, lossId };
}

export async function defaultsFor(companyId: string): Promise<DefaultAccountMap> {
  await ensureDefaultAccountMappings(companyId);
  const row = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  return row as unknown as DefaultAccountMap;
}

export type ControlKind = "receivables" | "payables" | "inventory";

/**
 * Accounts that carry a subledger: receivables and payables (company defaults and any party-specific account)
 * and inventory. Postings to them must go through the module that keeps the subledger.
 */
export async function controlAccounts(companyId: string): Promise<Map<string, ControlKind>> {
  const [defaults, settings, customers, suppliers, inventoryAccounts] = await Promise.all([
    prisma.defaultPostingAccounts.findUnique({ where: { companyId } }),
    prisma.inventoryAccountingSettings.findUnique({ where: { companyId } }),
    prisma.customer.findMany({ where: { companyId, arAccountId: { not: null } }, select: { arAccountId: true }, distinct: ["arAccountId"] }),
    prisma.supplier.findMany({ where: { companyId, apAccountId: { not: null } }, select: { apAccountId: true }, distinct: ["apAccountId"] }),
    prisma.account.findMany({ where: { companyId, isInventoryAccount: true }, select: { id: true } }),
  ]);
  const map = new Map<string, ControlKind>();
  for (const a of inventoryAccounts) map.set(a.id, "inventory");
  if (defaults?.inventoryAssetId) map.set(defaults.inventoryAssetId, "inventory");
  if (settings?.inventoryAssetAccountId) map.set(settings.inventoryAssetAccountId, "inventory");
  for (const c of customers) if (c.arAccountId) map.set(c.arAccountId, "receivables");
  if (defaults?.accountsReceivableId) map.set(defaults.accountsReceivableId, "receivables");
  for (const s of suppliers) if (s.apAccountId) map.set(s.apAccountId, "payables");
  if (defaults?.accountsPayableId) map.set(defaults.accountsPayableId, "payables");
  return map;
}

/**
 * Prices invoice or bill lines with the company's tax codes and checks each line account: it must belong to
 * the company, be active and not be a control account.
 */
const LINE_TAX_TYPES = {
  sales: ["OUTPUT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE"],
  purchase: ["INPUT_VAT", "IMPORT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE"],
} as const;

export async function priceDocumentLines(companyId: string, lines: DocumentLineInput[], documentDate: Date, side: keyof typeof LINE_TAX_TYPES) {
  const codes = [...new Set(lines.map((l) => l.taxCode?.trim().toUpperCase()).filter(Boolean) as string[])];
  const taxCodes = codes.length
    ? await prisma.taxCode.findMany({ where: { companyId, code: { in: codes, mode: "insensitive" } } })
    : [];
  const allowed: readonly string[] = LINE_TAX_TYPES[side];
  const wrong = taxCodes.find((c) => !allowed.includes(c.taxType));
  if (wrong) throw new Error(`Tax code ${wrong.code} is ${wrong.taxType} and can't be used on a ${side === "sales" ? "sales invoice" : "supplier bill"}`);
  // Without its own account, excise would fall to the VAT account and into the VAT return.
  const unmapped = taxCodes.find((c) => c.taxType === "EXCISE" && Number(c.ratePercent) > 0 && !c.glAccountId);
  if (unmapped) throw new Error(`Tax code ${unmapped.code} is excise and needs its own GL account before it can be used on a line`);
  const priced = computeDocumentLines(
    lines,
    taxCodes.map((c) => ({ ...c, ratePercent: Number(c.ratePercent) })),
    documentDate,
  );
  const accountIds = [...new Set(priced.lines.map((l) => l.accountId).filter(Boolean) as string[])];
  if (accountIds.length) {
    const [accounts, control] = await Promise.all([
      prisma.account.findMany({ where: { companyId, id: { in: accountIds } } }),
      controlAccounts(companyId),
    ]);
    for (const id of accountIds) {
      const account = accounts.find((a) => a.id === id);
      if (!account) throw new Error("A line account does not exist");
      if (!account.isActive) throw new Error(`Account ${account.code} is inactive`);
      if (!account.allowAutoPost) throw new Error(`Account ${account.code} does not accept automatic postings`);
      const kind = control.get(id);
      if (kind) throw new Error(`Account ${account.code} is the ${kind} control account and can't be used on a line`);
    }
  }
  return priced;
}

/**
 * Default accounts with every settlement account pointed at the chosen financial account's GL
 * account, so receipts and payments land in that bank, cash or mobile money account.
 */
export async function settlementDefaults(companyId: string, financialAccountId?: string | null): Promise<DefaultAccountMap> {
  const defaults = await defaultsFor(companyId);
  if (!financialAccountId) return defaults;
  const account = await prisma.financialAccount.findFirst({ where: { id: financialAccountId, companyId } });
  if (!account) throw new Error("The selected bank or cash account does not exist");
  if (!account.isActive) throw new Error(`${account.name} is inactive`);
  return { ...defaults, defaultBankAccountId: account.glAccountId, defaultCashAccountId: account.glAccountId, mobileMoneyClearingId: account.glAccountId };
}
