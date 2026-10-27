"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizationSettings = getOrganizationSettings;
exports.upsertOrganizationSettings = upsertOrganizationSettings;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const organization_settings_types_1 = require("../types/organization-settings.types");
/** Shallow-merges a possibly-partial/legacy JSON blob onto its typed default.
 *  Keeps records created before a key existed (or written by an older app
 *  version) fully populated without a backfill migration. */
function withDefaults(defaults, stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return defaults;
    }
    return { ...defaults, ...stored };
}
/** Fetches an organization's settings, applying DEFAULT_SETTINGS for any
 *  missing record or missing key. Never throws for a missing row — a brand
 *  new organization simply gets the platform defaults. */
async function getOrganizationSettings(organizationId) {
    const [row, org, branch] = await Promise.all([
        prisma_1.prisma.organizationSetting.findUnique({
            where: { organizationId },
            select: { sidebarConfig: true, featureFlags: true, preferences: true },
        }),
        prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { vatRegistered: true, TIN: true, ebmDeviceId: true },
        }),
        prisma_1.prisma.branch.findFirst({
            where: { organizationId, isDefault: true },
            select: { bhfId: true, ebmSerialNo: true },
        }),
    ]);
    return toTypedSettings(row, org?.vatRegistered ?? false, org ?? undefined, branch ?? undefined);
}
/**
 * Atomically applies a partial settings patch. Uses Postgres jsonb `||` to
 * merge at the database level instead of read-modify-write in application
 * code, so two concurrent requests patching different keys (e.g. one toggling
 * `allowNegativeStock`, another toggling `ebmIntegrationEnabled`) can never
 * silently clobber each other's change (classic lost-update race).
 */
async function upsertOrganizationSettings(organizationId, patch) {
    const sidebarPatch = patch.sidebarConfig ?? {};
    const featureFlagsPatch = patch.featureFlags ?? {};
    const preferencesPatch = patch.preferences ?? {};
    const ebmConfigPatch = patch.ebmConfig ?? {};
    const updateData = {};
    if (ebmConfigPatch.tin !== undefined)
        updateData.TIN = ebmConfigPatch.tin === "" ? null : ebmConfigPatch.tin;
    if (ebmConfigPatch.ebmDeviceId !== undefined)
        updateData.ebmDeviceId = ebmConfigPatch.ebmDeviceId === "" ? null : ebmConfigPatch.ebmDeviceId;
    if (ebmConfigPatch.dvcSrlNo !== undefined)
        updateData.ebmSerialNo = ebmConfigPatch.dvcSrlNo === "" ? null : ebmConfigPatch.dvcSrlNo;
    if (Object.keys(updateData).length > 0) {
        await prisma_1.prisma.organization.update({ where: { id: organizationId }, data: updateData });
    }
    const branchUpdateData = {};
    if (ebmConfigPatch.bhfId !== undefined)
        branchUpdateData.bhfId = ebmConfigPatch.bhfId === "" ? null : ebmConfigPatch.bhfId;
    if (ebmConfigPatch.dvcSrlNo !== undefined)
        branchUpdateData.ebmSerialNo = ebmConfigPatch.dvcSrlNo === "" ? null : ebmConfigPatch.dvcSrlNo;
    if (Object.keys(branchUpdateData).length > 0) {
        await prisma_1.prisma.branch.updateMany({
            where: { organizationId, isDefault: true },
            data: branchUpdateData,
        });
    }
    const rows = await prisma_1.prisma.$queryRaw(client_1.Prisma.sql `
    INSERT INTO "organization_settings" ("organizationId", "sidebarConfig", "featureFlags", "preferences", "createdAt", "updatedAt")
    VALUES (
      ${organizationId},
      ${JSON.stringify(sidebarPatch)}::jsonb,
      ${JSON.stringify(featureFlagsPatch)}::jsonb,
      ${JSON.stringify(preferencesPatch)}::jsonb,
      now(),
      now()
    )
    ON CONFLICT ("organizationId") DO UPDATE SET
      "sidebarConfig" = "organization_settings"."sidebarConfig" || EXCLUDED."sidebarConfig",
      "featureFlags"  = "organization_settings"."featureFlags"  || EXCLUDED."featureFlags",
      "preferences"   = "organization_settings"."preferences"   || EXCLUDED."preferences",
      "updatedAt" = now()
    RETURNING "sidebarConfig", "featureFlags", "preferences"
  `);
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { vatRegistered: true, TIN: true, ebmDeviceId: true },
    });
    const branch = await prisma_1.prisma.branch.findFirst({
        where: { organizationId, isDefault: true },
        select: { bhfId: true, ebmSerialNo: true },
    });
    return toTypedSettings(rows[0] ?? null, org?.vatRegistered ?? false, org ?? undefined, branch ?? undefined);
}
function toTypedSettings(row, vatRegistered, org, branch) {
    if (!row)
        return { ...organization_settings_types_1.DEFAULT_SETTINGS, vatRegistered, ebmConfig: { tin: org?.TIN ?? "", bhfId: branch?.bhfId ?? "", dvcSrlNo: branch?.ebmSerialNo ?? "", ebmDeviceId: org?.ebmDeviceId ?? "" } };
    return {
        sidebarConfig: withDefaults(organization_settings_types_1.DEFAULT_SETTINGS.sidebarConfig, row.sidebarConfig),
        featureFlags: withDefaults(organization_settings_types_1.DEFAULT_SETTINGS.featureFlags, row.featureFlags),
        preferences: withDefaults(organization_settings_types_1.DEFAULT_SETTINGS.preferences, row.preferences),
        vatRegistered,
        ebmConfig: {
            tin: org?.TIN ?? "",
            bhfId: branch?.bhfId ?? "",
            dvcSrlNo: branch?.ebmSerialNo ?? "",
            ebmDeviceId: org?.ebmDeviceId ?? "",
        },
    };
}
