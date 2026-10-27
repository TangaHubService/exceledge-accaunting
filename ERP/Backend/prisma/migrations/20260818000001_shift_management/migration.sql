-- AlterEnum
ALTER TYPE "ShiftStatus" ADD VALUE 'CLOSING';
ALTER TYPE "ShiftStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ShiftStatus" ADD VALUE 'REOPENED';
ALTER TYPE "ShiftStatus" ADD VALUE 'CANCELLED';

-- AlterTable (Shift)
ALTER TABLE "shifts" ADD COLUMN     "shift_number" TEXT,
ADD COLUMN     "opening_notes" TEXT,
ADD COLUMN     "closing_started_at" TIMESTAMP(3),
ADD COLUMN     "closing_submitted_at" TIMESTAMP(3),
ADD COLUMN     "closed_by" INTEGER,
ADD COLUMN     "approved_by" INTEGER,
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approval_decision" TEXT,
ADD COLUMN     "approval_reason" TEXT,
ADD COLUMN     "variance_reason" TEXT,
ADD COLUMN     "actual_mobile_money" DECIMAL(10,2),
ADD COLUMN     "cash_in" DECIMAL(10,2),
ADD COLUMN     "cash_out" DECIMAL(10,2),
ADD COLUMN     "expense_total" DECIMAL(10,2),
ADD COLUMN     "denomination_counts" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "shifts_shift_number_key" ON "shifts"("shift_number");

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_organizationId_shiftId_idx" ON "cash_movements"("organizationId", "shiftId");

-- CreateIndex
CREATE INDEX "cash_movements_shiftId_createdAt_idx" ON "cash_movements"("shiftId", "createdAt");

-- AlterTable (Expense)
ALTER TABLE "expenses" ADD COLUMN     "shiftId" INTEGER;

-- CreateIndex
CREATE INDEX "expenses_shiftId_idx" ON "expenses"("shiftId");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;