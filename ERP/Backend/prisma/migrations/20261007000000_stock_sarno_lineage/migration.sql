-- Stock SAR lineage (RRA VSDC v1.0.5): store orgSarNo link for refund/return
-- rows (NULL = no original / not confirmed; never assume 0) and guard the
-- MAX+1 allocation against concurrent duplicates per organization.
-- Reversible: see down.sql.

-- AlterTable
ALTER TABLE "inventory_ledger" ADD COLUMN "ebmOrgSarNo" INTEGER;

-- CreateIndex (unique per org; NULL sarNo rows do not conflict)
CREATE UNIQUE INDEX "inventory_ledger_organizationId_ebmSarNo_key" ON "inventory_ledger"("organizationId", "ebmSarNo");
