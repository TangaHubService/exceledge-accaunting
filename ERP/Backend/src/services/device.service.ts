import { prisma } from '../lib/prisma';

export interface RegisterDeviceParams {
  organizationId: number;
  userId: number;
  deviceHash: string;
  platform: string;
  name?: string;
}

/** Upserts by deviceHash so re-registering the same physical device (reinstall, relogin) doesn't create duplicates. */
export async function registerDevice(params: RegisterDeviceParams) {
  const { organizationId, userId, deviceHash, platform, name } = params;

  return prisma.device.upsert({
    where: { deviceHash },
    create: { organizationId, userId, deviceHash, platform, name, lastSeenAt: new Date() },
    update: { organizationId, userId, platform, name, isActive: true, lastSeenAt: new Date() },
  });
}

export async function deactivateDevice(id: number, organizationId: number) {
  const device = await prisma.device.findFirst({ where: { id, organizationId } });
  if (!device) throw new Error('Device not found');

  return prisma.device.update({
    where: { id },
    data: { isActive: false, deactivatedAt: new Date() },
  });
}

export async function listDevices(organizationId: number, userId?: number) {
  return prisma.device.findMany({
    where: { organizationId, ...(userId ? { userId } : {}) },
    orderBy: { lastSeenAt: 'desc' },
  });
}
