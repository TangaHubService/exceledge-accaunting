-- CreateTable
CREATE TABLE "vsdc_device_counters" (
    "organizationId" INTEGER NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vsdc_device_counters_pkey" PRIMARY KEY ("organizationId","deviceKey")
);

-- AddForeignKey
ALTER TABLE "vsdc_device_counters" ADD CONSTRAINT "vsdc_device_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
