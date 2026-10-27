-- RRA itemCd must be unique per taxpayer (VSDC spec §4.17). itemCd is nullable
-- because legacy products may not yet be synced to EBM, and Postgres unique
-- indexes allow multiple NULLs.
CREATE UNIQUE INDEX "products_organizationId_itemCd_key" ON "products"("organizationId", "itemCd");
