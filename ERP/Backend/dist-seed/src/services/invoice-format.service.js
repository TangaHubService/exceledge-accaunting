"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatInvoiceAmount = formatInvoiceAmount;
exports.formatInvoiceQuantity = formatInvoiceQuantity;
exports.formatInvoiceDateTime = formatInvoiceDateTime;
exports.groupFiscalValue = groupFiscalValue;
function formatInvoiceAmount(value) {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount))
        return "0.00";
    return amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
function formatInvoiceQuantity(value) {
    const quantity = Number(value ?? 0);
    if (!Number.isFinite(quantity))
        return "0";
    return quantity.toLocaleString("en-US", {
        minimumFractionDigits: Number.isInteger(quantity) ? 0 : 2,
        maximumFractionDigits: 3,
    });
}
function formatInvoiceDateTime(value) {
    if (!value)
        return { date: "", time: "" };
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return { date: String(value), time: "" };
    const p2 = (part) => String(part).padStart(2, "0");
    return {
        date: `${p2(parsed.getDate())}-${p2(parsed.getMonth() + 1)}-${parsed.getFullYear()}`,
        time: `${p2(parsed.getHours())}:${p2(parsed.getMinutes())}:${p2(parsed.getSeconds())}`,
    };
}
function groupFiscalValue(value) {
    const compact = value?.replace(/[-\s]/g, "") ?? "";
    return compact.match(/.{1,4}/g)?.join("-") ?? "";
}
