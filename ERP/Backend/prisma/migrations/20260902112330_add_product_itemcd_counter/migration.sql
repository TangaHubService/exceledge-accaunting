-- CreateTable
CREATE TABLE "product_itemcd_counters" (
    "organizationId" INTEGER NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_itemcd_counters_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "product_itemcd_counters" ADD CONSTRAINT "product_itemcd_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
