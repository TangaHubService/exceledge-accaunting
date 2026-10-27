"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizationLogo = getOrganizationLogo;
exports.getRraCertificationLogo = getRraCertificationLogo;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
let certificationLogo;
let organizationLogo;
function isPng(buffer) {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
function isJpeg(buffer) {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}
function supportedImage(buffer) {
    if (!buffer.length || buffer.length > MAX_LOGO_BYTES)
        return null;
    return isPng(buffer) || isJpeg(buffer) ? buffer : null;
}
/** Load the fixed RRA logo shown on every EBM invoice, regardless of organization. */
async function getOrganizationLogo() {
    if (organizationLogo !== undefined)
        return organizationLogo;
    const candidates = [
        path_1.default.resolve(__dirname, "../assets/rra-logo.png"),
        path_1.default.resolve(process.cwd(), "dist/assets/rra-logo.png"),
        path_1.default.resolve(process.cwd(), "src/assets/rra-logo.png"),
    ];
    for (const candidate of candidates) {
        try {
            organizationLogo = supportedImage(await fs_1.promises.readFile(candidate));
            if (organizationLogo)
                return organizationLogo;
        }
        catch {
            // Try the next build/development location.
        }
    }
    console.warn("[INVOICE-PDF] Bundled RRA logo asset is unavailable; continuing without it");
    organizationLogo = null;
    return null;
}
/** Load the controlled Rwanda certification seal supplied for EBM invoices. */
async function getRraCertificationLogo() {
    if (certificationLogo !== undefined)
        return certificationLogo;
    const candidates = [
        path_1.default.resolve(__dirname, "../assets/rra-ebm-certification.png"),
        path_1.default.resolve(process.cwd(), "dist/assets/rra-ebm-certification.png"),
        path_1.default.resolve(process.cwd(), "src/assets/rra-ebm-certification.png"),
    ];
    for (const candidate of candidates) {
        try {
            certificationLogo = supportedImage(await fs_1.promises.readFile(candidate));
            if (certificationLogo)
                return certificationLogo;
        }
        catch {
            // Try the next build/development location.
        }
    }
    console.warn("[INVOICE-PDF] RRA certification logo asset is unavailable; continuing without it");
    certificationLogo = null;
    return null;
}
