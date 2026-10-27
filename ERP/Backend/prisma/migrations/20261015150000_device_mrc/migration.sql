-- CIS spec Art. 3.2.1: every connected device carries its own Machine
-- Registration Code (MRC), separate from the VSDC device serial (dvcSrlNo)
-- sent to /initializer/selectInitInfo.
-- Reversible: see down.sql.

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "mrcNo" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "mrcNo" TEXT;

-- Seed from the MRC the VSDC already reported for initialized devices
-- (only a well-formed 11-character code).
UPDATE "branches"
SET "mrcNo" = UPPER(TRIM("ebmInitInfo"->>'mrcNo'))
WHERE "mrcNo" IS NULL
  AND "ebmInitInfo" IS NOT NULL
  AND UPPER(TRIM("ebmInitInfo"->>'mrcNo')) ~ '^[A-Z0-9]{11}$';
