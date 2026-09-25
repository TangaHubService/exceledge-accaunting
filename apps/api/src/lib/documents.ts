import { roundMoney, type DefaultAccountMap } from "@exceledge/accounting-domain";
import { ensureDefaultAccountMappings } from "../modules/setup/setup.service";
import { prisma } from "./prisma";

export function money(value: { toString(): string } | number | null | undefined) {
  return roundMoney(Number(value ?? 0));
}

/** Next document number for the company's sequence, e.g. BILL-2026-000001. */
export async function nextNumber(companyId: string, documentType: string, prefix: string) {
  await prisma.numberSequence.upsert({
    where: { companyId_documentType: { companyId, documentType } },
    create: {
      companyId,
      documentType,
      prefix,
      includeYear: true,
      sequenceLength: 6,
      startingNumber: 1,
      nextNumber: 1,
    },
    update: {},
  });
  const seq = await prisma.numberSequence.update({
    where: { companyId_documentType: { companyId, documentType } },
    data: { nextNumber: { increment: 1 } },
  });
  const n = seq.nextNumber - 1;
  const year = new Date().getUTCFullYear();
  return `${seq.prefix ?? prefix}-${year}-${String(n).padStart(seq.sequenceLength, "0")}`;
}

export async function defaultsFor(companyId: string): Promise<DefaultAccountMap> {
  await ensureDefaultAccountMappings(companyId);
  const row = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  return row as unknown as DefaultAccountMap;
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
