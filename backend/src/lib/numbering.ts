import { formatDocumentNumber, numberPeriodKey } from "@exceledge/accounting-domain";
import { prisma } from "./prisma";

/**
 * Allocates the next number for a document type using the company's numbering format (year,
 * month and branch segments, reset frequency). The counter row is incremented atomically, so
 * concurrent callers inside or outside a transaction get distinct numbers.
 */
export async function allocateNumber(
  companyId: string,
  documentType: string,
  defaultPrefix: string,
  opts: { date?: Date; branchId?: string | null } = {},
) {
  const date = opts.date ?? new Date();
  const seq = await prisma.numberSequence.upsert({
    where: { companyId_documentType: { companyId, documentType } },
    create: { companyId, documentType, prefix: defaultPrefix, includeYear: true, sequenceLength: 6, startingNumber: 1, nextNumber: 1 },
    update: {},
  });
  const periodKey = numberPeriodKey(seq.resetFrequency, date);
  const start = Math.max(seq.startingNumber, seq.legacyFloor, 1);
  await prisma.numberSequenceCounter.upsert({
    where: { sequenceId_periodKey: { sequenceId: seq.id, periodKey } },
    create: { sequenceId: seq.id, periodKey, nextNumber: start },
    update: {},
  });
  const counter = await prisma.numberSequenceCounter.update({
    where: { sequenceId_periodKey: { sequenceId: seq.id, periodKey } },
    data: { nextNumber: { increment: 1 } },
  });
  let branchCode: string | null = null;
  if (seq.includeBranch && opts.branchId) {
    const branch = await prisma.companyBranch.findFirst({
      where: { companyId, OR: [{ id: opts.branchId }, { externalErpBranchId: opts.branchId }] },
    });
    branchCode = branch?.code ?? branch?.externalErpBranchId ?? opts.branchId;
  }
  return formatDocumentNumber(
    {
      prefix: seq.prefix ?? defaultPrefix,
      includeYear: seq.includeYear,
      includeMonth: seq.includeMonth,
      includeBranch: seq.includeBranch,
      sequenceLength: seq.sequenceLength,
      resetFrequency: seq.resetFrequency,
    },
    counter.nextNumber - 1,
    date,
    branchCode,
  );
}
