"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeVsdcDevice = initializeVsdcDevice;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const logger_1 = __importDefault(require("../utils/logger"));
async function initializeVsdcDevice(organizationId, branchId) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: false, error: 'EBM is not enabled' };
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const res = await (0, vsdc_api_service_1.selectInitInfo)(envelope);
    if (!res.success) {
        return { success: false, error: `${res.resultCd}: ${res.resultMsg}` };
    }
    const info = res.data?.info;
    if (!info)
        return { success: false, error: 'RRA returned no device info' };
    // The device must belong to the same TIN we asked for (§22).
    if (info.tin && info.tin.trim() && info.tin.trim() !== envelope.tin.trim()) {
        return {
            success: false,
            error: `RRA device is registered to TIN ${info.tin}, not this organization's TIN ${envelope.tin}`,
        };
    }
    // Persist the returned identifiers + full payload on the branch.
    if (branchId != null) {
        await prisma_1.prisma.branch.update({
            where: { id: branchId },
            data: {
                ebmDeviceId: info.sdcId ?? undefined,
                ebmSerialNo: info.mrcNo ?? undefined,
                bhfId: info.bhfId ?? undefined,
                ebmInitializedAt: new Date(),
                ebmInitInfo: info,
            },
        });
    }
    else {
        await prisma_1.prisma.organization.update({
            where: { id: organizationId },
            data: {
                ebmDeviceId: info.sdcId ?? undefined,
                ebmSerialNo: info.mrcNo ?? undefined,
            },
        });
    }
    // Seed the invoice counter past RRA's last known number so the next sale
    // never collides (resultCd 924).
    const lastRraInvcNo = Number(info.lastSaleInvcNo ?? info.lastInvcNo ?? 0);
    let seededCounterTo;
    if (lastRraInvcNo > 0) {
        const deviceKey = envelope.bhfId ? `bhf:${envelope.bhfId}` : `branch:${branchId ?? 0}`;
        const rows = await prisma_1.prisma.$queryRaw `
      INSERT INTO "vsdc_device_counters" ("organizationId", "deviceKey", "nextSequence", "updatedAt")
      VALUES (${organizationId}, ${deviceKey}, ${lastRraInvcNo + 1}, NOW())
      ON CONFLICT ("organizationId", "deviceKey") DO UPDATE
        SET "nextSequence" = GREATEST("vsdc_device_counters"."nextSequence", ${lastRraInvcNo + 1}),
            "updatedAt" = NOW()
      RETURNING "nextSequence"
    `;
        seededCounterTo = Number(rows[0]?.nextSequence ?? 0);
    }
    await prisma_1.prisma.organization.update({
        where: { id: organizationId },
        data: { lastSuccessfulVdsContact: new Date() },
    });
    logger_1.default.info(`[VSDC-INIT] org ${organizationId} branch ${branchId ?? '-'}: sdcId=${info.sdcId} mrcNo=${info.mrcNo} lastRraInvcNo=${lastRraInvcNo} seededTo=${seededCounterTo ?? 'n/a'}`);
    return { success: true, info, seededCounterTo };
}
