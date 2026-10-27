-- Refunds used to leave sales.debtAmount unchanged while clearing debt first for accounting.
-- Bring remaining debt in line with prior refund totals (debt-first), once.
UPDATE "sales" AS s
SET "debtAmount" = GREATEST(0, s."debtAmount" - COALESCE(r.refunded, 0))
FROM (
  SELECT "original_sale_id" AS id, SUM(ABS("totalAmount")) AS refunded
  FROM "sales"
  WHERE "original_sale_id" IS NOT NULL
  GROUP BY "original_sale_id"
) AS r
WHERE s.id = r.id
  AND s."debtAmount" > 0
  AND r.refunded > 0;
