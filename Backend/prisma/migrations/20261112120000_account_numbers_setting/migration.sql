-- QuickBooks-style "Enable account numbers" company setting.
ALTER TABLE "accounting_policies" ADD COLUMN "useAccountNumbers" BOOLEAN NOT NULL DEFAULT true;
