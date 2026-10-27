import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { registerDevice, deactivateDevice, listDevices } from '../services/device.service';
import { auditLogger } from '../utils/auditLogger';

export const registerDeviceController = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user!.userId);
    const { deviceHash, platform, name } = req.body;

    if (!deviceHash || !platform) {
      return res.status(400).json({ error: 'deviceHash and platform are required' });
    }

    const device = await registerDevice({ organizationId, userId, deviceHash, platform, name });

    await auditLogger.system(req, {
      type: 'OTHER',
      description: `Device registered: ${name || platform}`,
      entityType: 'Device',
      entityId: device.id,
      metadata: { platform, name },
    });

    res.status(201).json(device);
  } catch (error: any) {
    console.error('[Register Device Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to register device' });
  }
};

export const listDevicesController = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const devices = await listDevices(organizationId);
    res.json(devices);
  } catch (error: any) {
    console.error('[List Devices Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to list devices' });
  }
};

export const deactivateDeviceController = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    const device = await deactivateDevice(id, organizationId);

    await auditLogger.system(req, {
      type: 'OTHER',
      description: `Device deactivated: ${device.name || device.platform}`,
      entityType: 'Device',
      entityId: device.id,
    });

    res.json(device);
  } catch (error: any) {
    console.error('[Deactivate Device Error]:', error);
    res.status(404).json({ error: error.message || 'Failed to deactivate device' });
  }
};
