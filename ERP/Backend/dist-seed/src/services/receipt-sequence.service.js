"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextReceiptSequence = nextReceiptSequence;
const prisma_1 = require("../lib/prisma");
/**
 * C7: Per-branch, per-receipt-type atomic sequence counter.
 * RRA CIS/VSDC spec §3.2 requires separate sequences for each label (NS, NR, CS, etc.)
 * Uses PostgreSQL upsert with RETURNING to guarantee no gaps under concurrent writes.
 */
async function nextReceiptSequence(branchId, rcptLabel) {
    const rows = await prisma_1.prisma.$queryRaw `
    INSERT INTO "branch_receipt_counters" ("branchId", "rcptLabel", "nextSeq", "updatedAt")
    VALUES (${branchId}, ${rcptLabel}::"RcptLabel", 1, NOW())
    ON CONFLICT ("branchId", "rcptLabel") DO UPDATE
    SET "nextSeq"    = "branch_receipt_counters"."nextSeq" + 1,
        "updatedAt"  = NOW()
    RETURNING "nextSeq"
  `;
    return Number(rows[0]?.nextSeq ?? 1);
}
