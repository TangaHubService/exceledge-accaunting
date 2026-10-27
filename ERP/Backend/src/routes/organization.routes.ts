import { Router } from "express";
import {
  getUserOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  inviteUser,
  bulkInviteUsers,
  acceptInvitation,
  getOrganizationUsers,
  removeUserFromOrganization,
  getInvitationDetails,
  cancelInvitation,
  declineInvitation,
  updateOrganizationAvatar,
  getOrgSettings,
  updateOrgSettings,
} from "../controllers/organization.controller";
import { authenticate } from "../middleware/auth.middleware";
import { uploadSingle } from "../middleware/upload.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";

const router = Router();

const orgAccess = requireOrganizationAccess();
const orgAccessById = requireOrganizationAccess("id");

router.get("/", authenticate, getUserOrganizations);
router.get("/:id", authenticate, orgAccessById, getOrganizationById);
router.post("/", authenticate, createOrganization);
router.put("/:id", authenticate, orgAccessById, updateOrganization);
router.put(
  "/avatar/:id",
  authenticate,
  orgAccessById,
  uploadSingle.single("avatar"),
  updateOrganizationAvatar
);
router.delete("/:id", authenticate, orgAccessById, deleteOrganization);
router.get("/:id/settings", authenticate, orgAccessById, getOrgSettings);
router.patch("/:id/settings", authenticate, orgAccessById, updateOrgSettings);
router.post("/:organizationId/invite", authenticate, orgAccess, inviteUser);
router.post("/:organizationId/bulk-invite", authenticate, orgAccess, bulkInviteUsers);
router.post("/accept-invitation/:token", acceptInvitation);
router.get("/get-invitation/:token", getInvitationDetails);
router.put("/cancel-invitation/:id", cancelInvitation);
router.put("/decline-invitation/:token", declineInvitation);
router.get("/:organizationId/users", authenticate, orgAccess, getOrganizationUsers);
router.delete(
  "/:organizationId/users/:userId",
  authenticate,
  orgAccess,
  removeUserFromOrganization
);

export default router;
