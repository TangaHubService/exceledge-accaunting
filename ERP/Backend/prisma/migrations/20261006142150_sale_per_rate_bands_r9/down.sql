-- Reversible rollback for sale_per_rate_bands_r9.
-- NOT executed by `prisma migrate`: apply manually with psql if needed.
-- Dropping the columns loses per-rate legs for rows created after the forward
-- migration; historical receipts themselves are untouched (columns were NULL
-- for all pre-existing rows).

ALTER TABLE "sales" DROP COLUMN "tax_amt_a",
                    DROP COLUMN "tax_amt_b",
                    DROP COLUMN "tax_amt_c",
                    DROP COLUMN "tax_amt_d",
                    DROP COLUMN "taxbl_amt_a",
                    DROP COLUMN "taxbl_amt_b",
                    DROP COLUMN "taxbl_amt_c",
                    DROP COLUMN "taxbl_amt_d";
