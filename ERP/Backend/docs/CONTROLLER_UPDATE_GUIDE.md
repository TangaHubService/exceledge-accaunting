# Controller Update Guide for Branch Filtering

This guide shows how to update existing controllers to support branch-based filtering.

## Overview

The branch management system requires updating controllers to:
1. Accept branch context from `branchAuth` middleware
2. Filter queries by branch
3. Assign branchId to new records

## Quick Reference

### 1. Import Required Types and Helpers

```typescript
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { buildBranchFilter, getBranchIdForOperation } from '../middleware/branchAuth.middleware';
```

### 2. Update Request Type

Change `AuthRequest` to `BranchAuthRequest`:

```typescript
// Before
export const getSales = async (req: AuthRequest, res: Response) => {

// After
export const getSales = async (req: BranchAuthRequest, res: Response) => {
```

### 3. Add Branch Filter to Queries

```typescript
// Before
const sales = await prisma.sale.findMany({
  where: { organizationId },
});

// After
const sales = await prisma.sale.findMany({
  where: {
    organizationId,
    ...buildBranchFilter(req),  // Add branch filtering
  },
});
```

### 4. Add branchId to Create Operations

```typescript
// Before
const sale = await prisma.sale.create({
  data: {
    organizationId,
    userId,
    // ... other fields
  },
});

// After
const sale = await prisma.sale.create({
  data: {
    organizationId,
    userId,
    branchId: getBranchIdForOperation(req),  // Add branchId
    // ... other fields
  },
});
```

## Controllers to Update

### Priority 1 (Core Operations)
- [x] `sales.controller.ts` - Sales operations
- [ ] `inventory.controller.ts` - Inventory management
- [ ] `expense.controller.ts` - Expense tracking

### Priority 2 (Reporting)
- [ ] `report.controller.ts` - Reports and analytics
- [ ] `dashboard.controller.ts` - Dashboard data

### Priority 3 (Supporting)
- [ ] `batch.controller.ts` - Batch management
- [ ] `inventory-ledger.controller.ts` - Ledger operations
- [ ] `debtPayment.controller.ts` - Debt payments

## Example: Sales Controller Updates

### GET /sales (List Sales)

```typescript
export const getSales = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { startDate, endDate, customerId, limit, search, status } = req.query;

    const where: any = { 
      organizationId,
      ...buildBranchFilter(req),  // ✅ Add branch filter
    };

    // ... rest of filtering logic

    const sales = await prisma.sale.findMany({
      where,
      include: {
        customer: true,
        user: true,
        branch: true,  // ✅ Include branch info
        saleItems: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
    });

    res.json(sales);
  } catch (error) {
    // ... error handling
  }
};
```

### POST /sales (Create Sale)

```typescript
export const createSale = async (req: BranchAuthRequest, res: Response) => {
  try {
    const { customerId, items, paymentType, cashAmount, debtAmount, insuranceAmount } = req.body;
    const userId = parseInt(req.user?.userId as string);
    const organizationId = parseInt(req.params.organizationId);
    
    // ✅ Get branchId for this operation
    const branchId = getBranchIdForOperation(req);

    // ... validation logic

    const sale = await prisma.$transaction(async (tx) => {
      // ✅ Stock validation should filter by branch
      for (const item of items) {
        const ledgerEntries = await tx.inventoryLedger.findMany({
          where: {
            productId: parseInt(item.productId),
            organizationId,
            branchId,  // ✅ Filter by branch
          },
          // ... rest of query
        });
        
        // ... validation logic
      }

      // ✅ Create sale with branchId
      const newSale = await tx.sale.create({
        data: {
          saleNumber,
          invoiceNumber,
          customerId: parseInt(customerId),
          userId,
          organizationId,
          branchId,  // ✅ Add branchId
          paymentType,
          cashAmount: cashAmount || 0,
          insuranceAmount: insuranceAmount || 0,
          debtAmount: debtAmount || 0,
          totalAmount,
          status: 'COMPLETED',
          saleItems: {
            create: saleItemsData,
          },
        },
        include: {
          saleItems: { include: { product: true, batch: true } },
          customer: true,
          branch: true,  // ✅ Include branch
        },
      });

      // ✅ Record stock movements with branchId
      for (const item of items) {
        await removeStock({
          organizationId,
          productId: parseInt(item.productId),
          userId,
          quantity: item.quantity,
          movementType: 'SALE',
          branchId,  // ✅ Add branchId
          reference: saleNumber,
          referenceType: 'SALE',
          note: `Sale #${saleNumber}`,
          tx,
        });
      }

      return newSale;
    });

    res.status(201).json(sale);
  } catch (error: any) {
    // ... error handling
  }
};
```

## Route Updates

Update routes to include `branchAuth` middleware:

```typescript
// routes/sales.routes.ts

import { authenticate } from '../middleware/auth.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';

// Before
router.get('/:organizationId/sales', authenticate, getSales);
router.post('/:organizationId/sales', authenticate, createSale);

// After
router.get('/:organizationId/sales', authenticate, branchAuth, getSales);
router.post('/:organizationId/sales', authenticate, branchAuth, createSale);
```

## Testing

### Test Branch Filtering

```bash
# Get sales for all branches (admin only)
curl -H "Authorization: Bearer $TOKEN" \
  -H "x-branch-scope: ALL" \
  http://localhost:3000/api/organizations/1/sales

# Get sales for specific branch
curl -H "Authorization: Bearer $TOKEN" \
  -H "x-branch-scope: SINGLE" \
  -H "x-branch-ids: 1" \
  http://localhost:3000/api/organizations/1/sales

# Get sales for multiple branches
curl -H "Authorization: Bearer $TOKEN" \
  -H "x-branch-scope: MULTI" \
  -H "x-branch-ids: 1,2,3" \
  http://localhost:3000/api/organizations/1/sales
```

### Test Create with Branch

```bash
# Create sale (branchId auto-assigned from user's primary branch)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customerId":1,"items":[...],"paymentType":"CASH","cashAmount":100}' \
  http://localhost:3000/api/organizations/1/sales

# Create sale with explicit branchId
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branchId":2,"customerId":1,"items":[...],"paymentType":"CASH","cashAmount":100}' \
  http://localhost:3000/api/organizations/1/sales
```

## Migration Notes

During the transition period:
- `warehouseId` fields are kept optional for backward compatibility
- New records should use `branchId`
- Run the migration script to convert existing data
- Update frontend to send `branchId` instead of `warehouseId`

## Common Patterns

### Pattern 1: List with Filtering
```typescript
const where: any = {
  organizationId,
  ...buildBranchFilter(req),
};
```

### Pattern 2: Create with Branch
```typescript
const branchId = getBranchIdForOperation(req);
await prisma.model.create({
  data: { ...data, branchId },
});
```

### Pattern 3: Update with Branch Validation
```typescript
const record = await prisma.model.findFirst({
  where: {
    id,
    organizationId,
    ...buildBranchFilter(req),  // Ensures user has access
  },
});
```

## Checklist for Each Controller

- [ ] Import `BranchAuthRequest` and helpers
- [ ] Update function signatures to use `BranchAuthRequest`
- [ ] Add `buildBranchFilter(req)` to all list/query operations
- [ ] Add `branchId` to all create operations using `getBranchIdForOperation(req)`
- [ ] Include `branch` in response includes where appropriate
- [ ] Update routes to include `branchAuth` middleware
- [ ] Test all endpoints with different branch scopes
