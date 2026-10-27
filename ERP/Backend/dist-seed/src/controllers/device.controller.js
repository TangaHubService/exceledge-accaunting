"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateDeviceController = exports.listDevicesController = exports.registerDeviceController = void 0;
const device_service_1 = require("../services/device.service");
const auditLogger_1 = require("../utils/auditLogger");
const registerDeviceController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user.userId);
        const { deviceHash, platform, name } = req.body;
        if (!deviceHash || !platform) {
            return res.status(400).json({ error: 'deviceHash and platform are required' });
        }
        const device = await (0, device_service_1.registerDevice)({ organizationId, userId, deviceHash, platform, name });
        await auditLogger_1.auditLogger.system(req, {
            type: 'OTHER',
            description: `Device registered: ${name || platform}`,
            entityType: 'Device',
            entityId: device.id,
            metadata: { platform, name },
        });
        res.status(201).json(device);
    }
    catch (error) {
        console.error('[Register Device Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to register device' });
    }
};
exports.registerDeviceController = registerDeviceController;
const listDevicesController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const devices = await (0, device_service_1.listDevices)(organizationId);
        res.json(devices);
    }
    catch (error) {
        console.error('[List Devices Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to list devices' });
    }
};
exports.listDevicesController = listDevicesController;
const deactivateDeviceController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const device = await (0, device_service_1.deactivateDevice)(id, organizationId);
        await auditLogger_1.auditLogger.system(req, {
            type: 'OTHER',
            description: `Device deactivated: ${device.name || device.platform}`,
            entityType: 'Device',
            entityId: device.id,
        });
        res.json(device);
    }
    catch (error) {
        console.error('[Deactivate Device Error]:', error);
        res.status(404).json({ error: error.message || 'Failed to deactivate device' });
    }
};
exports.deactivateDeviceController = deactivateDeviceController;
