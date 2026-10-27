import { BranchStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface CreateBranchParams {
  organizationId: number;
  name: string;
  code: string;
  location?: string;
  address?: string;
  phone?: string;
  metadata?: any;
}

export interface UpdateBranchParams {
  name?: string;
  location?: string;
  address?: string;
  addressLine2?: string;
  phone?: string;
  status?: BranchStatus;
  metadata?: any;
  // C10: RRA EBM device credentials
  bhfId?: string | null;
  ebmDeviceId?: string | null;
  ebmSerialNo?: string | null;
  /** Already normalized by checkMrc. */
  mrcNo?: string | null;
  vsdcUrl?: string | null;
}

/**
 * Get all branches for an organization
 */
export async function getBranches(
  organizationId: number,
  includeInactive: boolean = false
) {
  const where: any = {
    organizationId,
  };

  if (!includeInactive) {
    where.status = BranchStatus.ACTIVE;
  }

  return await prisma.branch.findMany({
    where,
    include: {
      _count: {
        select: {
          userBranches: true,
          sales: true,
          batches: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'desc' },
    ],
  });
}

/**
 * Get a single branch by ID
 */
export async function getBranchById(branchId: number, organizationId: number) {
  return await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId,
    },
    include: {
      _count: {
        select: {
          userBranches: true,
          sales: true,
          batches: true,
          stockMovements: true,
          expenses: true,
        },
      },
    },
  });
}

/**
 * Create a new branch
 */
export async function createBranch(params: CreateBranchParams) {
  const { organizationId, name, code, location, address, phone, metadata } = params;

  // Check if code is unique within organization
  const existing = await prisma.branch.findFirst({
    where: {
      organizationId,
      code,
    },
  });

  if (existing) {
    throw new Error(`Branch code ${code} already exists in this organization`);
  }

  // Create branch
  return await prisma.branch.create({
    data: {
      organizationId,
      name,
      code,
      location,
      address,
      phone,
      metadata,
      status: BranchStatus.ACTIVE,
    },
  });
}

/**
 * Update a branch
 */
export async function updateBranch(
  branchId: number,
  organizationId: number,
  data: UpdateBranchParams
) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId,
    },
  });

  if (!branch) {
    throw new Error(`Branch with ID ${branchId} not found`);
  }

  const patch: UpdateBranchParams & { bhfId?: string | null } = { ...data };

  // RRA bhfId is unique per org (@@unique([organizationId, bhfId])).
  // Normalize whitespace; empty → null so multiple unset branches don't collide.
  if (data.bhfId !== undefined) {
    const normalized =
      data.bhfId == null || String(data.bhfId).trim() === ''
        ? null
        : String(data.bhfId).trim();
    patch.bhfId = normalized;

    if (normalized != null) {
      const clash = await prisma.branch.findFirst({
        where: {
          organizationId,
          bhfId: normalized,
          NOT: { id: branchId },
        },
        select: { id: true, code: true, name: true },
      });
      if (clash) {
        throw Object.assign(
          new Error(
            `Branch code (bhfId) "${normalized}" is already used by ${clash.name} (${clash.code}). Each branch needs a unique RRA branch id (e.g. MAIN=00, East=01).`,
          ),
          { statusCode: 409 },
        );
      }
    }
  }

  if (data.ebmSerialNo !== undefined) {
    patch.ebmSerialNo =
      data.ebmSerialNo == null || String(data.ebmSerialNo).trim() === ''
        ? null
        : String(data.ebmSerialNo).trim();
  }

  if (data.ebmDeviceId !== undefined) {
    patch.ebmDeviceId =
      data.ebmDeviceId == null || String(data.ebmDeviceId).trim() === ''
        ? null
        : String(data.ebmDeviceId).trim();
  }

  if (data.vsdcUrl !== undefined) {
    patch.vsdcUrl =
      data.vsdcUrl == null || String(data.vsdcUrl).trim() === ''
        ? null
        : String(data.vsdcUrl).trim();
  }

  try {
    return await prisma.branch.update({
      where: { id: branchId },
      data: patch,
    });
  } catch (err: any) {
    if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('bhfId')) {
      throw Object.assign(
        new Error(
          `Branch code (bhfId) "${patch.bhfId ?? ''}" is already used by another branch. Each branch needs a unique RRA branch id (e.g. MAIN=00, East=01).`,
        ),
        { statusCode: 409 },
      );
    }
    throw err;
  }
}

/**
 * Set a branch as the organization's default branch, unsetting any other
 * branch previously marked as default.
 */
export async function setDefaultBranch(branchId: number, organizationId: number) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId,
    },
  });

  if (!branch) {
    throw new Error(`Branch with ID ${branchId} not found`);
  }

  await prisma.branch.updateMany({
    where: { organizationId, isDefault: true, NOT: { id: branchId } },
    data: { isDefault: false },
  });

  return await prisma.branch.update({
    where: { id: branchId },
    data: { isDefault: true },
  });
}

/**
 * Delete a branch (soft delete by setting status to INACTIVE)
 */
export async function deleteBranch(branchId: number, organizationId: number) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId,
    },
  });

  if (!branch) {
    throw new Error(`Branch with ID ${branchId} not found`);
  }

  // Check if branch has inventory
  const hasInventory = await prisma.batch.findFirst({
    where: {
      branchId: branchId,
      quantity: { gt: 0 },
    },
  });

  if (hasInventory) {
    // Soft delete - just deactivate
    return await prisma.branch.update({
      where: { id: branchId },
      data: {
        status: BranchStatus.INACTIVE,
      },
    });
  } else {
    // Hard delete if no inventory
    return await prisma.branch.delete({
      where: { id: branchId },
    });
  }
}

/**
 * Assign a user to a branch
 */
export async function assignUserToBranch(
  userId: number,
  branchId: number,
  isPrimary: boolean = false
) {
  // If setting as primary, unset other primary branches for this user
  if (isPrimary) {
    await prisma.userBranch.updateMany({
      where: {
        userId,
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    });
  }

  // Create or update user-branch assignment
  return await prisma.userBranch.upsert({
    where: {
      userId_branchId: {
        userId,
        branchId,
      },
    },
    create: {
      userId,
      branchId,
      isPrimary,
    },
    update: {
      isPrimary,
    },
  });
}

/**
 * Remove a user from a branch
 */
export async function removeUserFromBranch(userId: number, branchId: number) {
  return await prisma.userBranch.delete({
    where: {
      userId_branchId: {
        userId,
        branchId,
      },
    },
  });
}

/**
 * Get all branches for a user
 */
export async function getUserBranches(
  userId: number,
  organizationId?: number,
  includeInactive: boolean = false
) {
  const where: any = {
    userId,
  };

  const branchWhere: any = {};
  if (organizationId) branchWhere.organizationId = organizationId;
  if (!includeInactive) branchWhere.status = BranchStatus.ACTIVE;

  if (Object.keys(branchWhere).length > 0) {
    where.branch = branchWhere;
  }

  const userBranches = await prisma.userBranch.findMany({
    where,
    include: {
      branch: {
        include: {
          _count: {
            select: {
              sales: true,
              batches: true,
            },
          },
        },
      },
    },
    orderBy: [
      { isPrimary: 'desc' },
      { branch: { name: 'asc' } },
    ],
  });

  return userBranches.map((ub) => ({
    ...ub.branch,
    isPrimary: ub.isPrimary,
  }));
}

/**
 * Get primary branch for a user
 */
export async function getUserPrimaryBranch(userId: number) {
  const userBranch = await prisma.userBranch.findFirst({
    where: {
      userId,
      isPrimary: true,
    },
    include: {
      branch: true,
    },
  });

  return userBranch?.branch || null;
}

/**
 * Get all users assigned to a branch
 */
export async function getBranchUsers(branchId: number) {
  const userBranches = await prisma.userBranch.findMany({
    where: {
      branchId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  return userBranches.map((ub) => ({
    ...ub.user,
    isPrimary: ub.isPrimary,
  }));
}
