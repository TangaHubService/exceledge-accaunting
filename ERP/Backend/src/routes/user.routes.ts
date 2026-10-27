import { Router } from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserProfileImage,
  deleteUser,
  reactivateUser,
} from "../controllers/user.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { uploadSingle, handleUploadError } from "../middleware/upload.middleware";

const router = Router();

const orgAccess = requireOrganizationAccess();

router.get(
  "/:organizationId",
  authenticate,
  orgAccess,
  authorize("ADMIN", "BRANCH_MANAGER"),
  getUsers
);
router.get("/:id", authenticate, getUserById);
router.post("/", authenticate, authorize("ADMIN"), createUser);
// Authorization here is intentionally NOT a single role list: this endpoint
// is shared between "edit my own profile" (any authenticated org member) and
// "an admin changes someone else's role/status" (Admin/System Owner only,
// and never targeting another Admin/System Owner). Those rules depend on the
// specific target user and fields being changed, so they are enforced inside
// updateUser itself rather than via a coarse role gate here — see
// user.controller.ts for the full authorization logic.
router.put("/:organizationId/update/:id", authenticate, orgAccess, updateUser);

// Profile image upload route with error handling
router.put(
  "/profile-image/:id",
  authenticate,
  authorize("ADMIN", "BRANCH_MANAGER", "SELLER"),
  (req, res, next) => {
    uploadSingle.single('profileImage')(req, res, (err) => {
      if (err) {
        return handleUploadError(err, req, res, next);
      }
      next();
    });
  },
  updateUserProfileImage
);

router.delete("/:id", authenticate, authorize("ADMIN"), deleteUser);

router.put("/:organizationId/reactivate/:id", authenticate, orgAccess, authorize("ADMIN", "BRANCH_MANAGER"), reactivateUser);

export default router;
