-- CS/CR copies (CIS §6, §15): every copy is submitted to VSDC as salesTyCd "C"
-- and gets its own counter and signature. The VSDC confirmation of each copy
-- is stored as an ebm_transactions row with operation COPY.
-- Reversible: see down.sql.

-- AlterEnum
ALTER TYPE "EbmOperation" ADD VALUE IF NOT EXISTS 'COPY';
