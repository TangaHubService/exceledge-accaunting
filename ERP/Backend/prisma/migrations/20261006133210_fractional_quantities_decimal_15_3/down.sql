-- Reversible rollback for fractional_quantities_decimal_15_3.
-- NOT executed by `prisma migrate` (Prisma has no down-migration runner):
-- apply manually with psql if fractional quantities must be reverted.
--
-- WARNING: lossy when fractional quantities exist. Verify first:
--   SELECT COUNT(*) FROM sale_items WHERE quantity <> FLOOR(quantity);
--   (repeat for batches, inventory_ledger, products, stock_movements)
-- Historical receipts are NEVER rewritten by the forward migration; only the
-- column types change, existing whole-unit values are preserved exactly.

ALTER TABLE "sale_items" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER;
ALTER TABLE "batches" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER;
ALTER TABLE "inventory_ledger" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER,
                               ALTER COLUMN "runningBalance" TYPE INTEGER USING "runningBalance"::INTEGER;
ALTER TABLE "products" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER;
ALTER TABLE "stock_movements" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER,
                              ALTER COLUMN "previousStock" TYPE INTEGER USING "previousStock"::INTEGER,
                              ALTER COLUMN "newStock" TYPE INTEGER USING "newStock"::INTEGER;
