const express = require("express");
const Joi = require("joi");
const caseController = require("../controllers/caseController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");
const {
  validateBody,
  validateQuery,
  schemas,
} = require("../middleware/validation");

const router = express.Router();

// All case routes require authentication
router.use(authenticateToken);

// Get all cases with filtering and pagination
router.get("/", validateQuery(schemas.caseQuery), caseController.getCases);

// Get case statistics
router.get("/stats", caseController.getCaseStats);

// Get available tags
router.get("/tags", caseController.getAvailableTags);

// Export cases to CSV
router.get(
  "/export",
  validateQuery(schemas.caseQuery),
  caseController.exportCases
);

// Bulk update cases
router.patch(
  "/bulk-update",
  validateBody(
    Joi.object({
      caseIds: Joi.array().items(Joi.string()).required(),
      updates: schemas.updateCase.required(),
    })
  ),
  caseController.bulkUpdateCases
);

// Get single case by ID
router.get("/:id", caseController.getCaseById);

// Create new case
router.post("/", validateBody(schemas.createCase), caseController.createCase);

// Update existing case
router.patch(
  "/:id",
  validateBody(schemas.updateCase),
  caseController.updateCase
);

// Update case metadata
router.patch(
  "/:id/metadata",
  validateBody(
    Joi.object({
      metadata: Joi.object().required(),
    })
  ),
  caseController.updateCaseMetadata
);

// Delete case (admin only)
router.delete("/:id", authorizeRole(["admin"]), caseController.deleteCase);

module.exports = router;
