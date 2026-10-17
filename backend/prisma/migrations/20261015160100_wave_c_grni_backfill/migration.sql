-- Bills posted before goods receipts were matched: record how much goods received not invoiced their journal
-- already cleared, so a later goods receipt does not move the same amount again.
UPDATE "ap_bills" b
SET "grniCleared" = s."cleared"
FROM (
    SELECT b2."id", SUM(jl."debit") AS "cleared"
    FROM "ap_bills" b2
    JOIN "default_posting_accounts" d ON d."companyId" = b2."companyId"
    LEFT JOIN "inventory_accounting_settings" i ON i."companyId" = b2."companyId"
    JOIN "journal_lines" jl ON jl."journalId" = b2."journalId" AND jl."accountId" = COALESCE(i."grniAccountId", d."grniId")
    GROUP BY b2."id"
) s
WHERE b."id" = s."id" AND s."cleared" > 0;
