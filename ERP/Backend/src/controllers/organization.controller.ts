import { prisma } from "../lib/prisma";
import * as XLSX from "xlsx";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { emailService } from "../services/email.service";
import { generateStrongPassword } from "../utils/generatePassword";
import { auditLogger } from "../utils/auditLogger";
import { lockReceiptModeForChange } from "../services/training-mode.service";
import { deleteFromCloudinary, uploadToCloudinary } from "../config/cloudinary";
import { SubscriptionService } from "../services/subscription.service";
import {
  getOrganizationSettings,
  upsertOrganizationSettings,
} from "../services/organization-settings.service";
import type { OrganizationSettingsPatch } from "../types/organization-settings.types";
import { checkMrc, MrcFormatError } from "../utils/mrc";

import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

const subscriptionService = new SubscriptionService(prisma);

class TinResetBlockedError extends Error {
  constructor(unsent: number) {
    super(`Cannot change the TIN while ${unsent} sale/refund/void document(s) are still waiting for RRA under the current TIN.`);
  }
}

export const getUserOrganizations = async (req: Request, res: Response) => {
  try {
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);
    const userOrganizations = await prisma.userOrganization.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            subscriptions: true,
          },
        },
      },
    });

    res.json({
      organizations: userOrganizations.map((uo) => ({
        id: uo.organization.id,
        name: uo.organization.name,
        businessType: uo.organization.businessType,
        address: uo.organization.address,
        phone: uo.organization.phone,
        email: uo.organization.email,
        role: uo.role,
        isActive: uo.organization.isActive,
        subscription: uo.organization.subscriptions,
      })),
    });
  } catch (error) {
    console.error("Error fetching user organizations:", error);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
};

export const getOrganizationById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId: id,
      },
    });

    if (!userOrganization) {
      return res
        .status(403)
        .json({ error: "Access denied to this organization" });
    }

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: {
            createdAt: 'desc'
          }
        },
      },
    });

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const organizationUsers = await prisma.userOrganization.findMany({
      where: { organizationId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    // Check subscription status — the most recently-ending subscription that's
    // still ACTIVE/TRIALING/GRACE_PERIOD (grace-period rows have an endDate in
    // the past by definition, so this intentionally doesn't filter on endDate).
    const relevantSubscription = organization.subscriptions
      .filter(sub => sub.status === 'ACTIVE' || sub.status === 'TRIALING' || sub.status === 'GRACE_PERIOD')
      .sort((a, b) => (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0))[0] ?? null;

    const subscriptionSummary = subscriptionService.computeSubscriptionSummary(relevantSubscription);

    res.json({
      organization: {
        ...organization,
        hasActiveSubscription: subscriptionSummary.hasActiveSubscription,
        subscriptionStatus: subscriptionSummary.subscriptionStatus,
        subscriptionEndDate: subscriptionSummary.subscriptionEndDate,
        daysUntilExpiry: subscriptionSummary.daysUntilExpiry,
        graceDaysRemaining: subscriptionSummary.graceDaysRemaining,
        graceDayLabel: subscriptionSummary.graceDayLabel,
        subscriptionWarningLevel: subscriptionSummary.warningLevel,
        subscriptionWarningMessage: subscriptionSummary.warningMessage,
        role: userOrganization.role,
        isOwner: userOrganization.isOwner,
      },
      users: organizationUsers
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    res.status(500).json({ error: "Failed to fetch organization" });
  }
};

export const createOrganization = async (req: Request, res: Response) => {
  try {
    const { name, businessType, address, phone, email } = req.body;
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    if (!name || !businessType || !address || !email) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Resolve the free-trial plan before creating anything, so a missing
    // plan can't leave behind an organization with no subscription.
    const freeTrialPlan = await prisma.subscriptionPlan.findFirst({
      where: { name: "Free Trial" }
    });

    if (!freeTrialPlan) {
      return res.status(400).json({ error: 'Free Trial plan not found. Please contact support.' });
    }

    const organization = await prisma.organization.create({
      data: {
        name,
        businessType,
        address,
        phone,
        email,
        isActive: true,
      },
    });

    await prisma.$transaction(async (tx: any) => {
      await tx.userOrganization.create({
        data: {
          userId: userId!,
          organizationId: organization.id,
          role: "ADMIN",
          isOwner: true,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: "ADMIN" },
      });
      // Create default branch
      const branch = await tx.branch.create({
        data: {
          name: "Main Branch",
          code: "MAIN-001",
          organizationId: organization.id,
          status: 'ACTIVE',
        },
      });
      // Assign user to branch as primary
      await tx.userBranch.create({
        data: {
          userId: userId!,
          branchId: branch.id,
          isPrimary: true,
        },
      });
    });
    try {
      await subscriptionService.createTrial(organization.id, freeTrialPlan.id);
    } catch (subscriptionError) {
      await prisma.organization.delete({ where: { id: organization.id } });
      return res.status(500).json({ error: 'Failed to create free trial subscription' });
    }

    // Fetch updated user data to include in response
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      }
    });

    res.status(201).json({
      message: "Organization created successfully",
      organization: {
        id: organization.id,
        name: organization.name,
        businessType: organization.businessType,
        address: organization.address,
        phone: organization.phone,
        email: organization.email,
        role: "ADMIN",
        isOwner: true,
      },
      user: updatedUser, // Include updated user data
    });
  } catch (error) {
    console.error("Error creating organization:", error);
    res.status(500).json({ error: "Failed to create organization" });
  }
};

export const updateOrganization = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const {
      name,
      businessType,
      address,
      phone,
      email,
      TIN,
      VRN,
      vatRegistered,
      isTaxExempt,
      taxExemptionReason,
      currency,
      ebmDeviceId,
      ebmSerialNo,
      mrcNo,
      trainingMode,
    } = req.body;
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId: id,
        role: "ADMIN",
      },
    });

    if (!userOrganization) {
      return res
        .status(403)
        .json({ error: "Only admins can update organization details" });
    }

    if (ebmDeviceId !== undefined && ebmDeviceId !== null && typeof ebmDeviceId !== "string") {
      return res.status(400).json({ error: "ebmDeviceId must be a string" });
    }
    if (ebmSerialNo !== undefined && ebmSerialNo !== null && typeof ebmSerialNo !== "string") {
      return res.status(400).json({ error: "ebmSerialNo must be a string" });
    }
    if (mrcNo !== undefined && mrcNo !== null && typeof mrcNo !== "string") {
      return res.status(400).json({ error: "mrcNo must be a string" });
    }
    if (trainingMode !== undefined && typeof trainingMode !== "boolean") {
      return res.status(400).json({ error: "trainingMode must be true or false" });
    }

    const existingOrg = await prisma.organization.findUnique({
      where: { id },
      select: { trainingMode: true, mrcNo: true, TIN: true },
    });
    const previousTrainingMode = existingOrg?.trainingMode ?? false;

    // CIS spec §7.2: a TIN change is a total VSDC reset. The device, its SDC
    // identity, the per-device invoice/purchase counters and the RRA sync
    // cursors all belong to the old TIN, so they are cleared and every device
    // must be re-initialized (validateVsdcEnvelope refuses until it is). The
    // change is refused while documents are still queued for the old TIN.
    // Historical invoices are kept untouched for audit; only the numbering
    // seed ignores them (sequences restart after the reset, §7.3).
    const previousTin = existingOrg?.TIN?.trim() || "";
    const nextTin = typeof TIN === "string" ? TIN.trim() : undefined;
    const tinChanged = nextTin !== undefined && previousTin !== "" && nextTin !== previousTin;
    if (tinChanged) {
      if (req.body?.confirmTinReset !== true) {
        return res.status(409).json({
          error: "Changing the TIN resets the RRA VSDC device: every branch must be re-initialized and fiscal numbering restarts. Resend with confirmTinReset=true to proceed.",
          code: "TIN_RESET_CONFIRMATION_REQUIRED",
        });
      }
      const [unsentSales, unsentPurchases] = await Promise.all([
        prisma.ebmOutbox.count({ where: { organizationId: id, status: { in: ["PENDING", "PROCESSING", "FAILED"] } } }),
        prisma.vsdcLocalPurchase.count({ where: { organizationId: id, status: { in: ["PENDING", "FAILED"] } } }),
      ]);
      if (unsentSales > 0 || unsentPurchases > 0) {
        return res.status(409).json({
          error: `Cannot change the TIN while documents are still waiting for RRA under the current TIN (${unsentSales} sale/refund/void, ${unsentPurchases} purchase). Let them fiscalize or resolve them in the EBM queue first.`,
          code: "TIN_RESET_BLOCKED_UNSENT",
        });
      }
    }

    // CIS spec Art. 3.2.1 MRC format (relaxed in sandbox/mock), same rule as branch update.
    const mrc = checkMrc(mrcNo, { current: [existingOrg?.mrcNo] });
    if (!mrc.ok) {
      return res.status(400).json({ error: mrc.error, code: mrc.code });
    }

    // A mode switch waits for in-flight sales/refunds (they hold the shared
    // receipt-mode lock) so no receipt commits under a mode it did not read.
    const organization = await prisma.$transaction(async (tx) => {
      if ((trainingMode !== undefined && trainingMode !== previousTrainingMode) || tinChanged) {
        await lockReceiptModeForChange(tx, id);
      }
      if (tinChanged) {
        const unsent = await tx.ebmOutbox.count({
          where: { organizationId: id, status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
        });
        if (unsent > 0) {
          throw new TinResetBlockedError(unsent);
        }
        await tx.branch.updateMany({
          where: { organizationId: id },
          data: { ebmDeviceId: null, ebmInitializedAt: null, ebmInitInfo: Prisma.DbNull },
        });
        await tx.$executeRaw`DELETE FROM "vsdc_device_counters" WHERE "organizationId" = ${id}`;
        await tx.rraSyncCursor.deleteMany({ where: { organizationId: id } });
        // Stock movements not yet reported belong to the old TIN; they are
        // detached from the queue rather than sent under the new one.
        await tx.inventoryLedger.updateMany({
          where: { organizationId: id, ebmSyncStatus: { in: ["PENDING", "FAILED"] } },
          data: { ebmSyncStatus: null, ebmError: "Not reported: organization TIN was reset" },
        });
      }
      return tx.organization.update({
        where: { id },
        data: {
          name,
          businessType,
          address,
          phone,
          email,
          TIN,
          currency,
          ...(VRN !== undefined
            ? { VRN: VRN === "" ? null : VRN }
            : {}),
          ...(vatRegistered !== undefined
            ? { vatRegistered: !!vatRegistered }
            : {}),
          ...(isTaxExempt !== undefined
            ? { isTaxExempt: !!isTaxExempt }
            : {}),
          ...(taxExemptionReason !== undefined
            ? { taxExemptionReason: taxExemptionReason === "" ? null : taxExemptionReason }
            : {}),
          ...(ebmDeviceId !== undefined
            ? { ebmDeviceId: ebmDeviceId === "" ? null : ebmDeviceId }
            : {}),
          ...(ebmSerialNo !== undefined
            ? { ebmSerialNo: ebmSerialNo == null || ebmSerialNo.trim() === "" ? null : ebmSerialNo.trim() }
            : {}),
          ...(mrc.value !== undefined
            ? { mrcNo: mrc.value }
            : {}),
          // CIS §5.3/§16: while on, every new sale is a Training Sale (TS) and
          // only TS receipts can be refunded (as TR). Training receipts go to
          // VSDC as salesTyCd 'T' and never touch stock, debt, payments or
          // accounting. Admin-only, same as the other fiscal-behavior fields.
          ...(trainingMode !== undefined
            ? { trainingMode }
            : {}),
          ...(tinChanged
            ? { ebmTinResetAt: new Date(), ebmInitializedAt: null, lastSuccessfulVdsContact: null, ebmDeviceId: null }
            : {}),
        },
      });
    }).catch((e: unknown) => {
      if (e instanceof TinResetBlockedError) return e;
      throw e;
    });
    if (organization instanceof TinResetBlockedError) {
      return res.status(409).json({ error: organization.message, code: "TIN_RESET_BLOCKED_UNSENT" });
    }
    if (tinChanged) {
      await auditLogger.system(req, {
        type: 'SETTINGS_UPDATE',
        description: `Organization TIN changed from ${previousTin} to ${nextTin}: VSDC device state reset, re-initialization required`,
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { setting: 'TIN', from: previousTin, to: nextTin },
      });
    }

    await auditLogger.system(req, {
      type: 'SETTINGS_UPDATE',
      description: `Organization "${organization.name}" details updated`,
      entityType: 'Organization',
      entityId: organization.id,
      metadata: { updates: req.body }
    });
    if (trainingMode !== undefined && trainingMode !== previousTrainingMode) {
      await auditLogger.system(req, {
        type: 'SETTINGS_UPDATE',
        description: `Training mode ${trainingMode ? 'ENABLED' : 'DISABLED'} for "${organization.name}"`,
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { setting: 'trainingMode', from: previousTrainingMode, to: trainingMode },
      });
    }

    res.json({
      message: "Organization updated successfully",
      organization,
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    res.status(500).json({ error: "Failed to update organization" });
  }
};

/** Any org member may read settings — the client needs them to render the sidebar/flags. */
export const getOrgSettings = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.id);
    const settings = await getOrganizationSettings(organizationId);
    res.json({ settings });
  } catch (error) {
    console.error("Error fetching organization settings:", error);
    res.status(500).json({ error: "Failed to fetch organization settings" });
  }
};

function isPlainPatchObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only admins may change workspace-shaping settings; SYSTEM_OWNER bypasses this check
 *  (their global role, not a per-org membership, grants access). */
export const updateOrgSettings = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.id);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);
    //@ts-ignore
    const isSystemOwner = req.user?.role === "SYSTEM_OWNER";

    if (!isSystemOwner) {
      const userOrganization = await prisma.userOrganization.findFirst({
        where: { userId, organizationId, role: "ADMIN" },
      });

      if (!userOrganization) {
        return res
          .status(403)
          .json({ error: "Only admins can update organization settings" });
      }
    }

    const { sidebarConfig, featureFlags, preferences, ebmConfig } = req.body ?? {};
    const patch: OrganizationSettingsPatch = {};

    for (const [key, value] of Object.entries({ sidebarConfig, featureFlags, preferences, ebmConfig })) {
      if (value === undefined) continue;
      if (!isPlainPatchObject(value) && key !== "ebmConfig") {
        return res.status(400).json({ error: `${key} must be an object` });
      }
      if (key === "ebmConfig") {
        patch.ebmConfig = value as OrganizationSettingsPatch["ebmConfig"];
      } else {
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    const settings = await upsertOrganizationSettings(organizationId, patch);

    await auditLogger.system(req, {
      type: "SETTINGS_UPDATE",
      description: `Organization settings updated`,
      entityType: "OrganizationSetting",
      entityId: organizationId,
      metadata: { patch },
    });

    res.json({ message: "Organization settings updated successfully", settings });
  } catch (error) {
    if (error instanceof MrcFormatError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error("Error updating organization settings:", error);
    res.status(500).json({ error: "Failed to update organization settings" });
  }
};

export const deleteOrganization = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId: id,
        role: "ADMIN",
      },
    });

    if (!userOrganization) {
      return res
        .status(403)
        .json({ error: "Only admins can delete organization" });
    }

    await prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ message: "Organization deleted successfully" });
  } catch (error) {
    console.error("Error deleting organization:", error);
    res.status(500).json({ error: "Failed to delete organization" });
  }
};

export const inviteUser = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { email, role, branchId } = req.body;
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const requiredFields = { email, role };
    for (const [key, value] of Object.entries(requiredFields)) {
      if (!value) {
        return res.status(400).json({ error: `${key} is required` });
      }
    }

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        role: { in: ["ADMIN"] },
      },
    });

    if (!userOrganization) {
      return res.status(403).json({ error: "Only admins can invite users" });
    }

    // If branchId is provided, validate it belongs to the organization
    let validatedBranchId: number | undefined;
    if (branchId !== undefined && branchId !== null && branchId !== '') {
      const parsedBranchId = parseInt(String(branchId), 10);
      if (isNaN(parsedBranchId)) {
        return res.status(400).json({ error: "Invalid branch ID" });
      }
      const branch = await prisma.branch.findFirst({
        where: { id: parsedBranchId, organizationId },
      });
      if (!branch) {
        return res.status(400).json({ error: "Branch not found in this organization" });
      }
      validatedBranchId = parsedBranchId;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const existingUserOrganization = await prisma.userOrganization.findFirst({
        where: {
          userId: existingUser.id,
          organizationId,
        },
      });

      if (existingUserOrganization) {
        return res
          .status(400)
          .json({ error: "User already exists in this organization" });
      }

      // For existing users, still create an invitation and send email
      // They need to accept it to join the organization
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Fetch organization details
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId! },
        select: { name: true, email: true },
      });

      if (!organization) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const invitation = await prisma.organizationInvitation.create({
        data: {
          organizationId: organizationId!,
          email,
          role,
          token,
          invitedBy: userId!,
          expiresAt,
          invitedUserId: existingUser.id, // Link to existing user
          defaultPassword: "",
          ...(validatedBranchId !== undefined ? { branchId: validatedBranchId } : {}),
        },
      });

      await emailService.sendInvitationEmail(
        email,
        organization.name,
        role,
        token,
        null // No password needed for existing users
      );

      await auditLogger.users(req, {
        type: 'USER_INVITE',
        description: `Invitation sent to existing user: ${email}`,
        entityType: 'User',
        entityId: existingUser.id,
        metadata: {
          email,
          role,
        }
      });

      return res.json({
        message: "Invitation sent to existing user successfully. They need to accept it to join the organization.",
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const plainPassword = generateStrongPassword(12);
    const defaultPassword = await bcrypt.hash(plainPassword, 10);

    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: organizationId!,
        email,
        role,
        token,
        defaultPassword,
        invitedBy: userId!,
        expiresAt,
        ...(validatedBranchId !== undefined ? { branchId: validatedBranchId } : {}),
      },
      include: {
        organization: true,
      },
    });

    await emailService.sendInvitationEmail(
      email,
      invitation.organization.name,
      role,
      token,
      plainPassword
    );

    await auditLogger.users(req, {
      type: 'USER_INVITE',
      description: `New user invitation sent: ${email}`,
      entityType: 'User',
      entityId: invitation.id,
      metadata: {
        email,
        role,
      }
    });

    res.status(201).json({
      message: "Invitation sent successfully",
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
      },
    });
  } catch (error) {
    console.error("Error inviting user:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
};

export const bulkInviteUsers = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        role: "ADMIN",
      },
    });

    if (!userOrganization) {
      return res.status(403).json({ error: "Only admins can invite users" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Excel file is required" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const invitations = [];
    const errors = [];

    for (const row of data as any[]) {
      try {
        const email = row.email || row.Email;
        const role = row.role || row.Role;

        if (!email || !role) {
          errors.push({ row, error: "Missing email or role" });
          continue;
        }

        if (
          !["ADMIN", "MANAGER", "ACCOUNTANT", "STAFF"].includes(
            role.toUpperCase()
          )
        ) {
          errors.push({ row, error: "Invalid role" });
          continue;
        }

        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          const existingUserOrganization =
            await prisma.userOrganization.findFirst({
              where: {
                userId: existingUser.id,
                organizationId,
              },
            });

          if (existingUserOrganization) {
            errors.push({
              row,
              error: "User already exists in this organization",
            });
            continue;
          }
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        const plainPassword = crypto.randomBytes(8).toString("hex");
        const defaultPassword = await bcrypt.hash(plainPassword, 10);

        const invitation = await prisma.organizationInvitation.create({
          data: {
            organizationId: organizationId!,
            email,
            role: role.toUpperCase(),
            token,
            expiresAt,
            defaultPassword: defaultPassword,
            invitedBy: userId!,
          },
          include: {
            organization: true,
          },
        });

        await emailService.sendInvitationEmail(
          email,
          invitation.organization.name,
          token,
          role.toUpperCase(),
          plainPassword
        );

        invitations.push({
          email,
          role: role.toUpperCase(),
          status: "sent",
        });
      } catch (error) {
        errors.push({ row, error: "Failed to process invitation" });
      }
    }

    await auditLogger.users(req, {
      type: 'USER_INVITE',
      description: `Bulk invitations sent for organization ${organizationId}`,
      entityType: 'Organization',
      entityId: organizationId,
      metadata: {
        successful: invitations.length,
        failed: errors.length,
      }
    });

    res.status(201).json({
      message: "Bulk invitation completed",
      successful: invitations.length,
      failed: errors.length,
      invitations,
      errors,
    });
  } catch (error) {
    console.error("Error bulk inviting users:", error);
    res.status(500).json({ error: "Failed to process bulk invitations" });
  }
};
export const cancelInvitation = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "CANCELLED" },
    });

    await auditLogger.users(req, {
      type: 'USER_INVITE',
      description: `Invitation ${id} cancelled`,
      entityType: 'User',
      entityId: id,
      status: 'FAILED',
    });

    res.json({ message: "Invitation cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling invitation:", error);
    res.status(500).json({ error: "Failed to cancel invitation" });
  }
};

export const getInvitationDetails = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            name: true,
            email: true,
            businessType: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    res.json(invitation);
  } catch (error) {
    console.error("Error getting invitation details:", error);
    res.status(500).json({ error: "Failed to get invitation details" });
  }
};

export const declineInvitation = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation?.status !== "PENDING") {
      return res.status(400).json({ error: "Invitation already processed" });
    }

    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "DECLINED" },
    });

    await auditLogger.users(req, {
      type: 'USER_INVITE',
      description: `Invitation ${invitation.id} declined by ${invitation.email}`,
      entityType: 'User',
      entityId: invitation.id,
      status: 'FAILED',
    });

    emailService.sendInvitationAcceptedOrDeclinedEmail(
      invitation.organization.email!,
      invitation.organization.name,
      "DECLINED",
      invitation.email
    );

    res.json({ message: "Invitation declined successfully" });
  } catch (error) {
    console.error("Error declining invitation:", error);
    res.status(500).json({ error: "Failed to decline invitation" });
  }
};

export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const { token } = req.params;

    if (!token || !name) {
      return res.status(400).json({ error: "Token and name are required" });
    }

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation.status !== "PENDING") {
      return res.status(400).json({ error: "Invitation already processed" });
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      return res.status(400).json({ error: "Invitation has expired" });
    }

    let user = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: invitation.email,
          name,
          role: invitation.role,
          password: invitation.defaultPassword,
          requirePasswordChange: true,
          defaultPassword: invitation.defaultPassword,
          isEmailVerified: true,
          isActive: true,
        },
      });
    }

    // Check if user is already in the organization (for existing users)
    const existingUserOrg = await prisma.userOrganization.findFirst({
      where: {
        userId: user.id,
        organizationId: invitation.organizationId,
      },
    });

    if (!existingUserOrg) {
      await prisma.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          isOwner: false,
        },
      });
    }

    // If invitation is branch-scoped, assign user to that specific branch
    if (invitation.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: invitation.branchId, organizationId: invitation.organizationId },
      });

      if (branch) {
        const existingUserBranch = await prisma.userBranch.findFirst({
          where: { userId: user.id, branchId: branch.id },
        });

        if (!existingUserBranch) {
          await prisma.userBranch.create({
            data: {
              userId: user.id,
              branchId: branch.id,
              isPrimary: true,
            },
          });
        }
      }
    }
    // If no branchId, user has org-wide access (not restricted to any specific branch)

    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: {
        status: "ACCEPTED",
        invitedUserId: user.id,
      },
    });

    await auditLogger.users(req, {
      type: 'USER_ACCEPT_INVITE',
      description: `Invitation accepted by ${user.email}`,
      entityType: 'User',
      entityId: user.id,
      metadata: { invitationId: invitation.id }
    });

    emailService.sendInvitationAcceptedOrDeclinedEmail(
      invitation.organization.email!,
      invitation.organization.name,
      "ACCEPTED",
      invitation.email
    );
    res.json({
      message: "Invitation accepted successfully",
      organization: invitation.organization,
      requirePasswordChange: true,
    });
  } catch (error) {
    console.error("Error accepting invitation:", error);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
};

export const getOrganizationUsers = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
      },
    });

    if (!userOrganization) {
      return res
        .status(403)
        .json({ error: "Access denied to this organization" });
    }

    const users = await prisma.userOrganization.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    res.json({
      users: users.map((uo) => ({
        id: uo.user.id,
        email: uo.user.email,
        name: uo.user.name,
        role: uo.role,
      })),
    });
  } catch (error) {
    console.error("Error fetching organization users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const removeUserFromOrganization = async (
  req: Request,
  res: Response
) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const targetUserId = parseInt(req.params.userId);
    //@ts-ignore
    const userId = parseInt(req.user?.userId as string);

    const userOrganization = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        role: "ADMIN",
      },
    });

    if (!userOrganization) {
      return res.status(403).json({ error: "Only admins can remove users" });
    }

    if (userId === targetUserId) {
      return res
        .status(400)
        .json({ error: "Cannot remove yourself from organization" });
    }

    await prisma.userOrganization.deleteMany({
      where: {
        userId: targetUserId,
        organizationId,
      },
    });

    await auditLogger.users(req, {
      type: 'USER_ROLE_UPDATE',
      description: `User "${targetUserId}" removed from organization`,
      entityType: 'User',
      entityId: targetUserId,
      status: 'SUCCESS',
    });

    res.json({ message: "User removed successfully" });
  } catch (error) {
    console.error("Error removing user:", error);
    res.status(500).json({ error: "Failed to remove user" });
  }
};

export const updateOrganizationAvatar = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existingOrg = await prisma.organization.findUnique({ where: { id } });
    if (!existingOrg) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    let avatar = existingOrg.avatar;

    if (req.file) {
      if (avatar) {
        await deleteFromCloudinary(avatar);
      }

      const result: any = await uploadToCloudinary(req.file);
      avatar = result.secure_url;
    }

    const updatedOrg = await prisma.organization.update({
      where: { id },
      data: {
        ...(avatar && { avatar }),
      },
    });

    res.json(updatedOrg);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ message: 'Error updating organization' });
  }
};
