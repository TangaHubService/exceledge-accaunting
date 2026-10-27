-- Shift columns added in 20260818000001 used snake_case, but the shifts table
-- convention (openingFloat, expectedCash, actualCash, difference, closingNotes)
-- is camelCase with no @map. Rename to match the schema so Prisma can query them.

ALTER TABLE "shifts" RENAME COLUMN "actual_mobile_money" TO "actualMobileMoney";
ALTER TABLE "shifts" RENAME COLUMN "cash_in" TO "cashIn";
ALTER TABLE "shifts" RENAME COLUMN "cash_out" TO "cashOut";
ALTER TABLE "shifts" RENAME COLUMN "expense_total" TO "expenseTotal";
