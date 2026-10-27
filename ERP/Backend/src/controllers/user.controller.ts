import type { Response } from "express";
import bcrypt from "bcryptjs";
import type { AuthRequest } from "../middleware/auth.middleware";
import { auditLogger } from "../utils/auditLogger";
import { deleteFromCloudinary, uploadToCloudinary } from "../config/cloudinary";
import { prisma } from "../lib/prisma";
import { getOrderBy } from "../utils/sorting";

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const search = req.query.search as string;
    const status = req.query.status as string;
    const { page = "1", limit = "50" } = req.query;

    const limitNum = Math.min(Math.max(Number.parseInt(limit as string) || 50, 1), 500);
    const pageNum = Math.max(Number.parseInt(page as string) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const whereClause: any = {
      organizationId,
      user: { deletedAt: null }
    };

    // Filter by status: active, disabled, or all
    if (status === 'active') {
      whereClause.user.isActive = true;
    } else if (status === 'disabled') {
      whereClause.user.isActive = false;
    }
    // 'all' or undefined shows both active and disabled

    if (search) {
      whereClause.OR = [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [userOrganizations, totalCount] = await Promise.all([
      prisma.userOrganization.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              isActive: true,
              createdAt: true,
              disabledAt: true,
              reactivatedAt: true,
            },
          },
        },
        orderBy: getOrderBy(req.query, {
          name: { user: { name: '$direction' } },
          email: { user: { email: '$direction' } },
          status: { user: { isActive: '$direction' } },
          role: { role: '$direction' },
          createdAt: { user: { createdAt: '$direction' } },
        }, 'createdAt', 'desc'),
        skip,
        take: limitNum,
      }),
      prisma.userOrganization.count({ where: whereClause }),
    ]);

    const users = userOrganizations.map((uo) => ({
      ...uo.user,
      role: uo.role,
      isOwner: uo.isOwner,
    }));

    res.json({
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    console.error("[Get Users Error]:", error);
    res.status(500).json({ error: "Failed to get users" });
  }
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId: id,
        organizationId,
        user: { deletedAt: null }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    if (!userOrganization) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      ...userOrganization.user,
      role: userOrganization.role,
      isOwner: userOrganization.isOwner,
    });
  } catch (error) {
    console.error("[Get User Error]:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { email, password, name, role } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email, deletedAt: null },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
      },
    });

    await prisma.userOrganization.create({
      data: {
        userId: user.id,
        organizationId: organizationId!,
        role,
        isOwner: false, // Default value for isOwner
      },
    });

    await auditLogger.users(req, {
      type: 'USER_CREATED',
      description: `New user "${user.name}" created and added to organization`,
      entityType: 'User',
      entityId: user.id,
      metadata: {
        email: user.email,
        role,
      }
    });

    const { syncUserToRraAsync } = await import('../services/rra-branch-sync.service');
    syncUserToRraAsync(organizationId!, user.id, {
      actorUserId: req.user?.userId ? Number(req.user.userId) : undefined,
    });

    res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    console.error("[Create User Error]:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

// Roles assignable to an organization member through the update-user endpoint.
// SYSTEM_OWNER is a platform-level role, not something granted within an
// organization, so it is intentionally excluded here.
const ASSIGNABLE_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "SELLER"];
// Roles that only a SYSTEM_OWNER may ever modify (role or account status).
const PROTECTED_TARGET_ROLES = ["ADMIN", "SYSTEM_OWNER"];

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const requesterId = parseInt(String(req.user!.userId));
    // `organizations` is a client-side convenience field on some payloads; never persisted.
    const { organizations, ...updateData } = req.body;

    const userOrganization = await prisma.userOrganization.findFirst({
      where: { userId: id, organizationId: organizationId!, user: { deletedAt: null } },
    });

    if (!userOrganization) {
      return res.status(404).json({ error: "User not found" });
    }

    const isSystemOwner = req.user!.role === "SYSTEM_OWNER";
    // Authoritative actor role for this organization — never trust a stale JWT role
    // for cross-checking permissions inside a specific org.
    const actorMembership = isSystemOwner
      ? null
      : await prisma.userOrganization.findFirst({
          where: { userId: requesterId, organizationId: organizationId! },
          select: { role: true },
        });
    const actorRole = isSystemOwner ? "SYSTEM_OWNER" : actorMembership?.role;
    const isAdmin = isSystemOwner || actorRole === "ADMIN";
    const isSelf = requesterId === id;

    // Server-side authorization — never trust the frontend's hidden/disabled form fields.
    // Non-admins may only ever touch their own record, and only non-sensitive fields.
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: "Forbidden: you don't have permission to update this user" });
    }

    const changingRole = Object.prototype.hasOwnProperty.call(updateData, "role");
    const changingStatus = Object.prototype.hasOwnProperty.call(updateData, "isActive");

    if (changingRole || changingStatus) {
      // Only admins/system owner may change roles or account status — ever.
      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: only administrators can change roles or account status" });
      }
      // Prevent privilege escalation: an org Admin (not SYSTEM_OWNER) may never
      // modify another Admin's or a System Owner's role/status.
      if (!isSystemOwner && PROTECTED_TARGET_ROLES.includes(userOrganization.role)) {
        return res.status(403).json({ error: "Forbidden: only a System Owner can modify an Admin's role or account status" });
      }
      // Disallow self-service role/status changes to prevent self-escalation or self-lockout.
      if (isSelf) {
        return res.status(403).json({ error: "Forbidden: you cannot change your own role or account status" });
      }
      if (changingRole && !ASSIGNABLE_ROLES.includes(updateData.role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
    }

    const { role: newRole, isActive, ...userFields } = updateData;

    if (Object.keys(userFields).length > 0) {
      await prisma.user.update({
        where: { id },
        data: { ...userFields, ...(changingStatus ? { isActive } : {}) },
      });
    } else if (changingStatus) {
      await prisma.user.update({ where: { id }, data: { isActive } });
    }

    if (changingRole && newRole !== userOrganization.role) {
      await prisma.userOrganization.update({
        where: { id: userOrganization.id },
        data: { role: newRole },
      });
    }

    if (changingRole || changingStatus) {
      await auditLogger.users(req, {
        type: changingRole ? 'USER_ROLE_UPDATE' : (isActive ? 'USER_ACCOUNT_ENABLED' : 'USER_ACCOUNT_DISABLED'),
        description: `User ${id} ${changingRole ? `role changed from "${userOrganization.role}" to "${newRole}"` : `account ${isActive ? 'enabled' : 'disabled'}`} by user ${requesterId}`,
        entityType: 'User',
        entityId: id,
        metadata: {
          previousRole: userOrganization.role,
          newRole: changingRole ? newRole : undefined,
          isActive: changingStatus ? isActive : undefined,
          actorId: requesterId,
        },
      });
    } else if (Object.keys(userFields).length > 0) {
      await auditLogger.users(req, {
        type: 'OTHER',
        description: `User "${id}" profile updated`,
        entityType: 'User',
        entityId: id,
        metadata: { updates: userFields },
      });
    }

    res.json({ message: "User updated successfully" });
  } catch (error) {
    console.error("[Update User Error]:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const requesterId = parseInt(String(req.user!.userId));

    const userOrganization = await prisma.userOrganization.findFirst({
      where: { userId: id, organizationId, user: { deletedAt: null } },
    });

    if (!userOrganization) {
      return res.status(404).json({ error: "User not found" });
    }

    if (requesterId === id) {
      return res.status(400).json({ error: "You cannot disable your own account" });
    }

    const isSystemOwner = req.user!.role === "SYSTEM_OWNER";
    if (!isSystemOwner && PROTECTED_TARGET_ROLES.includes(userOrganization.role)) {
      return res.status(403).json({ error: "Forbidden: only a System Owner can disable an Admin's account" });
    }

    await prisma.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date(), disabledAt: new Date(), reactivatedAt: null }
    });

    await auditLogger.users(req, {
      type: 'USER_ACCOUNT_DISABLED',
      description: `User account disabled: ${id} by user ${requesterId}`,
      entityType: 'User',
      entityId: id,
      metadata: { actorId: requesterId, disabledAt: new Date().toISOString() },
    });

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("[Delete User Error]:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

export const reactivateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const requesterId = parseInt(String(req.user!.userId));

    const userOrganization = await prisma.userOrganization.findFirst({
      where: { userId: id, organizationId },
    });

    if (!userOrganization) {
      return res.status(404).json({ error: "User not found in this organization" });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isActive) {
      return res.status(400).json({ error: "User is already active" });
    }

    await prisma.user.update({
      where: { id },
      data: { isActive: true, deletedAt: null, reactivatedAt: new Date() }
    });

    await auditLogger.users(req, {
      type: 'USER_ACCOUNT_ENABLED',
      description: `User account reactivated: ${id} by user ${requesterId}`,
      entityType: 'User',
      entityId: id,
      metadata: { actorId: requesterId, reactivatedAt: new Date().toISOString() },
    });

    res.json({ message: "User reactivated successfully" });
  } catch (error) {
    console.error("[Reactivate User Error]:", error);
    res.status(500).json({ error: "Failed to reactivate user" });
  }
};

export const updateUserProfileImage = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existingUser = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    let profileImage = existingUser.profileImage;

    if (req.file) {
      // Delete old image if exists
      if (profileImage) {
        await deleteFromCloudinary(profileImage);
      }

      // Upload new image
      const result: any = await uploadToCloudinary(req.file);
      profileImage = result.secure_url;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(profileImage && { profileImage }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        profileImage: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Error updating user' });
  }
};
