-- Origin country must come from `/code/selectCodes` class 05 (or the operator),
-- not a hardcoded RW default.
ALTER TABLE "products" ALTER COLUMN "origin" DROP DEFAULT;
