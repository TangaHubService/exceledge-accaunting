"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("../controllers/user.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const upload_middleware_1 = require("../middleware/upload.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
router.get("/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, auth_middleware_1.authorize)("ADMIN", "BRANCH_MANAGER"), user_controller_1.getUsers);
router.get("/:id", auth_middleware_1.authenticate, user_controller_1.getUserById);
router.post("/", auth_middleware_1.authenticate, (0, auth_middleware_1.authorize)("ADMIN"), user_controller_1.createUser);
// Authorization here is intentionally NOT a single role list: this endpoint
// is shared between "edit my own profile" (any authenticated org member) and
// "an admin changes someone else's role/status" (Admin/System Owner only,
// and never targeting another Admin/System Owner). Those rules depend on the
// specific target user and fields being changed, so they are enforced inside
// updateUser itself rather than via a coarse role gate here — see
// user.controller.ts for the full authorization logic.
router.put("/:organizationId/update/:id", auth_middleware_1.authenticate, orgAccess, user_controller_1.updateUser);
// Profile image upload route with error handling
router.put("/profile-image/:id", auth_middleware_1.authenticate, (0, auth_middleware_1.authorize)("ADMIN", "BRANCH_MANAGER", "SELLER"), (req, res, next) => {
    upload_middleware_1.uploadSingle.single('profileImage')(req, res, (err) => {
        if (err) {
            return (0, upload_middleware_1.handleUploadError)(err, req, res, next);
        }
        next();
    });
}, user_controller_1.updateUserProfileImage);
router.delete("/:id", auth_middleware_1.authenticate, (0, auth_middleware_1.authorize)("ADMIN"), user_controller_1.deleteUser);
router.put("/:organizationId/reactivate/:id", auth_middleware_1.authenticate, orgAccess, (0, auth_middleware_1.authorize)("ADMIN", "BRANCH_MANAGER"), user_controller_1.reactivateUser);
exports.default = router;
