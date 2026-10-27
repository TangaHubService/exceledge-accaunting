"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const apiResponse_1 = require("../utils/apiResponse");
const errorHandler = (err, req, res, next) => {
    console.error("[Error]:", err);
    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const details = process.env.NODE_ENV === "development" ? err.stack : undefined;
    res.status(statusCode).json((0, apiResponse_1.error)(message, undefined, details));
};
exports.errorHandler = errorHandler;
