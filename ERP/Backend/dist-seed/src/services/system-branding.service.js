"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_FISCALIZED_NOTICE = exports.NOT_FISCALIZED_TITLE = exports.NOT_OFFICIAL_RECEIPT_NOTICE = exports.TRAINING_MODE_LABEL = exports.REFUND_NOTICE = exports.REFUND_DOCUMENT_LABEL = exports.CIS_VERSION_LABEL = exports.SYSTEM_FOOTER = exports.SYSTEM_POWERED_BY = exports.SYSTEM_VERSION = exports.SYSTEM_NAME = void 0;
const package_json_1 = __importDefault(require("../../package.json"));
exports.SYSTEM_NAME = "Excledge ERP";
exports.SYSTEM_VERSION = package_json_1.default.version;
exports.SYSTEM_POWERED_BY = `${exports.SYSTEM_NAME} v${exports.SYSTEM_VERSION}`;
exports.SYSTEM_FOOTER = `${exports.SYSTEM_POWERED_BY} Powered by RRA VSDC EBM 2.1.`;
/**
 * CIS/VSDC certification requirement §21: "CIS software must have a version
 * number which can be verified and printed on each receipt." This is the
 * labelled string printed in the fiscal block of every receipt renderer; the
 * same value is served verifiably at `GET /api/version`.
 */
exports.CIS_VERSION_LABEL = `Software version: v${exports.SYSTEM_VERSION}`;
/** RRA EBM refund receipt labels — kept as a single named source rather than inline literals. */
exports.REFUND_DOCUMENT_LABEL = "REFUND";
exports.REFUND_NOTICE = "REFUND IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT";
/** CIS/VSDC spec §16: the literal title text printed for receipt labels TS/TR. */
exports.TRAINING_MODE_LABEL = "TRAINING MODE";
/**
 * CIS/VSDC spec §11: required below the amount totals on COPY, TRAINING, and
 * PROFORMA receipts specifically (regardless of certification) — a genuine
 * NS/NR original must never carry it. Also shown as a fallback for any
 * receipt RRA has not (yet) certified.
 */
exports.NOT_OFFICIAL_RECEIPT_NOTICE = "THIS IS NOT AN OFFICIAL RECEIPT";
/**
 * Printed on a real (NS/NR) invoice that a user chose to download/print before
 * VSDC confirmed the sale. Such a document is deliberately not a fiscal receipt
 * — it carries no SDC signature, receipt number, or QR — so it is stamped
 * unmistakably as provisional. `_TITLE` is the watermark/title; `_NOTICE` is the
 * explanatory line shown with the "not an official receipt" block.
 */
exports.NOT_FISCALIZED_TITLE = "NOT FISCALISED";
exports.NOT_FISCALIZED_NOTICE = "THIS SALE IS NOT YET APPROVED BY THE TAX OFFICE — NOT A VALID TAX RECEIPT";
