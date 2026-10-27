"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSystemOwner = exports.restrictRoles = exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "No token provided" });
        }
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (error) {
        return res.status(401).json({ error: "Invalid token" });
    }
};
exports.authenticate = authenticate;
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        // Per-organization role from requireOrganizationAccess (authoritative for :organizationId routes)
        const orgRole = req.organizationRole;
        const effectiveRole = orgRole ?? req.user.role;
        const userRoles = Array.isArray(effectiveRole)
            ? effectiveRole
            : [effectiveRole];
        const hasRole = userRoles.some((role) => roles.includes(role));
        if (!hasRole) {
            return res
                .status(403)
                .json({ error: "Forbidden: You dont have permissions to perform this action" });
        }
        next();
    };
};
exports.authorize = authorize;
/**
 * Deny-list middleware — blocks the request if the user's role is in the
 * provided list. Use this for "everyone EXCEPT these roles" scenarios.
 *
 * Respects per-organization role from requireOrganizationAccess just like
 * authorize() does.
 *
 * @example
 * router.get("/subscriptions", authenticate, restrictRoles("SELLER"), ...);
 */
const restrictRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const orgRole = req.organizationRole;
        const effectiveRole = orgRole ?? req.user.role;
        if (roles.includes(effectiveRole)) {
            return res.status(403).json({
                error: "Forbidden: You do not have permission to access this resource",
            });
        }
        next();
    };
};
exports.restrictRoles = restrictRoles;
const requireSystemOwner = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.user.role !== "SYSTEM_OWNER") {
        return res
            .status(403)
            .json({ error: "Forbidden: System owner access required" });
    }
    next();
};
exports.requireSystemOwner = requireSystemOwner;
