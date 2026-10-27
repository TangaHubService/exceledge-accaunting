"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDevice = registerDevice;
exports.deactivateDevice = deactivateDevice;
exports.listDevices = listDevices;
const prisma_1 = require("../lib/prisma");
/** Upserts by deviceHash so re-registering the same physical device (reinstall, relogin) doesn't create duplicates. */
async function registerDevice(params) {
    const { organizationId, userId, deviceHash, platform, name } = params;
    return prisma_1.prisma.device.upsert({
        where: { deviceHash },
        create: { organizationId, userId, deviceHash, platform, name, lastSeenAt: new Date() },
        update: { organizationId, userId, platform, name, isActive: true, lastSeenAt: new Date() },
    });
}
async function deactivateDevice(id, organizationId) {
    const device = await prisma_1.prisma.device.findFirst({ where: { id, organizationId } });
    if (!device)
        throw new Error('Device not found');
    return prisma_1.prisma.device.update({
        where: { id },
        data: { isActive: false, deactivatedAt: new Date() },
    });
}
async function listDevices(organizationId, userId) {
    return prisma_1.prisma.device.findMany({
        where: { organizationId, ...(userId ? { userId } : {}) },
        orderBy: { lastSeenAt: 'desc' },
    });
}
