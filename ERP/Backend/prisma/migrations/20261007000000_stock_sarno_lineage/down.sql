-- Rollback for 20261007000000_stock_sarno_lineage (reversible migration).
DROP INDEX IF EXISTS "inventory_ledger_organizationId_ebmSarNo_key";
ALTER TABLE "inventory_ledger" DROP COLUMN IF EXISTS "ebmOrgSarNo";
