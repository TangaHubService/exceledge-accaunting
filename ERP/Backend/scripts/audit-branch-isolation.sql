-- ═══════════════════════════════════════════════════════════════════════════
-- Branch Data Isolation Audit Queries
-- Run these periodically to detect cross-branch data leakage.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Orphan Records: records with branchId that reference a non-existent branch
SELECT 'sales' AS table_name, COUNT(*) AS orphan_count
  FROM sales s LEFT JOIN branches b ON s."branchId" = b.id
 WHERE b.id IS NULL
UNION ALL
SELECT 'batches', COUNT(*) FROM batches b LEFT JOIN branches br ON b."branchId" = br.id WHERE br.id IS NULL
UNION ALL
SELECT 'stock_movements', COUNT(*) FROM stock_movements sm LEFT JOIN branches b ON sm."branchId" = b.id WHERE b.id IS NULL
UNION ALL
SELECT 'expenses', COUNT(*) FROM expenses e LEFT JOIN branches b ON e."branchId" = b.id WHERE b.id IS NULL
UNION ALL
SELECT 'cash_balances', COUNT(*) FROM cash_balances cb LEFT JOIN branches b ON cb."branchId" = b.id WHERE b.id IS NULL
UNION ALL
SELECT 'inventory_ledger', COUNT(*) FROM inventory_ledger il LEFT JOIN branches b ON il."branchId" = b.id WHERE b.id IS NULL
UNION ALL
SELECT 'activity_logs', COUNT(*) FROM activity_logs al LEFT JOIN branches b ON al."branchId" = b.id WHERE b.id IS NULL
UNION ALL
SELECT 'purchase_orders', COUNT(*) FROM purchase_orders po LEFT JOIN branches b ON po."branchId" = b.id WHERE b.id IS NULL;

-- 2. Organization Mismatch: records whose branch belongs to a DIFFERENT organization
-- This would indicate a serious data integrity bug.
SELECT 'sales' AS table_name, COUNT(*) AS org_mismatch_count
  FROM sales s
  JOIN branches b ON s."branchId" = b.id
 WHERE b."organizationId" != s."organizationId"
UNION ALL
SELECT 'batches', COUNT(*)
  FROM batches ba
  JOIN branches b ON ba."branchId" = b.id
 WHERE b."organizationId" != ba."organizationId"
UNION ALL
SELECT 'stock_movements', COUNT(*)
  FROM stock_movements sm
  JOIN branches b ON sm."branchId" = b.id
 WHERE b."organizationId" != sm."organizationId"
UNION ALL
SELECT 'expenses', COUNT(*)
  FROM expenses e
  JOIN branches b ON e."branchId" = b.id
 WHERE b."organizationId" != e."organizationId"
UNION ALL
SELECT 'purchase_orders', COUNT(*)
  FROM purchase_orders po
  JOIN branches b ON po."branchId" = b.id
 WHERE b."organizationId" != po."organizationId";

-- 3. Duplicate Batch Numbers across branches for the same product
-- (The unique constraint productId + batchNumber + branchId allows this,
--  but it may indicate an operational issue worth reviewing.)
SELECT p.name AS product_name,
       ba.batchNumber,
       COUNT(DISTINCT ba."branchId") AS branch_count,
       array_agg(DISTINCT br.name) AS branches
  FROM batches ba
  JOIN products p ON p.id = ba."productId"
  JOIN branches br ON br.id = ba."branchId"
 WHERE ba."isActive" = true
 GROUP BY p.name, ba.batchNumber
HAVING COUNT(DISTINCT ba."branchId") > 1;

-- 4. Sales with no branchId (should be 0 after migration)
SELECT COUNT(*) AS sales_without_branch
  FROM sales WHERE "branchId" IS NULL;

-- 5. Stock Transfers: ensure fromBranch and toBranch belong to same org
SELECT COUNT(*) AS cross_org_transfers
  FROM stock_transfers st
  JOIN branches fb ON st."fromBranchId" = fb.id
  JOIN branches tb ON st."toBranchId" = tb.id
 WHERE fb."organizationId" != tb."organizationId";

-- 6. RLS Policy Verification: Check that all policies are active
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
  FROM pg_policies
 WHERE tablename IN ('sales','batches','stock_movements','expenses',
                      'cash_balances','inventory_ledger','activity_logs',
                      'purchase_orders','stock_transfers')
 ORDER BY tablename, cmd;
