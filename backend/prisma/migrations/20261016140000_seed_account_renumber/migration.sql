-- Renumber system accounts whose codes fell outside Seg 3.7 type ranges.
-- Skip a remap when the target code already exists for that company (manual chart).

UPDATE "accounts" AS a
SET code = '6430', name = 'Bank Charges'
WHERE a.code = '2400'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '6430');

UPDATE "accounts" AS a
SET code = '1900', name = 'Suspense Account'
WHERE a.code = '6600'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '1900');

UPDATE "accounts" AS a
SET code = '4400', name = 'Sales Discounts'
WHERE a.code = '6800'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '4400');

UPDATE "accounts" AS a
SET code = '4410', name = 'Sales Returns'
WHERE a.code = '6810'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '4410');

UPDATE "accounts" AS a
SET code = '7200', name = 'Inventory Gain'
WHERE a.code = '6900'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '7200');

UPDATE "accounts" AS a
SET code = '1590', name = 'Asset Disposal'
WHERE a.code = '7100'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '1590');

UPDATE "accounts" AS a
SET code = '7300', name = 'Gain on Disposal'
WHERE a.code = '7110'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '7300');

UPDATE "accounts" AS a
SET code = '8100', name = 'Loss on Disposal'
WHERE a.code = '7120'
  AND NOT EXISTS (SELECT 1 FROM "accounts" x WHERE x."companyId" = a."companyId" AND x.code = '8100');
