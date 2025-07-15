const express = require("express");
const uploadController = require("../controllers/uploadController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");
const {
  validateBody,
  validateQuery,
  schemas,
} = require("../middleware/validation");
const Joi = require("joi");

const router = express.Router();

// All upload routes require authentication
router.use(authenticateToken);

// Get presigned URL for upload - ✅ UPDATED with description and source URL
router.post(
  "/presigned-url",
  validateBody(
    Joi.object({
      fileName: Joi.string().required(),
      fileType: Joi.string().required(),
      caseId: Joi.string().required(),
      captureType: Joi.string().valid("screenshot", "video").required(),
      fileSize: Joi.number().positive().optional(),
      uploadMethod: Joi.string().valid('PUT', 'POST').default('PUT'),
      // ✅ NEW: Add description and source URL validation
      description: Joi.string().max(1000).optional().allow(''),
      sourceUrl: Joi.string().uri().max(2000).optional().allow(''),
    })
  ),
  uploadController.getPresignedUrl
);

// Confirm successful upload - ✅ UPDATED with description and source URL
router.post(
  "/confirm",
  validateBody(
    Joi.object({
      fileId: Joi.string().optional(),
      fileKey: Joi.string().optional(),
      actualFileSize: Joi.number().positive().optional(),
      checksum: Joi.string().optional(),
      uploadMethod: Joi.string().valid('PUT', 'POST').default('PUT'),
      // ✅ NEW: Allow updating description and source URL during confirm
      description: Joi.string().max(1000).optional().allow(''),
      sourceUrl: Joi.string().uri().max(2000).optional().allow(''),
    }).or("fileId", "fileKey")
  ),
  uploadController.confirmUpload
);

// ✅ NEW: Update file metadata (description and source URL)
router.patch(
  "/file/:fileKey(*)/metadata",
  validateBody(
    Joi.object({
      description: Joi.string().max(1000).optional().allow(''),
      sourceUrl: Joi.string().uri().max(2000).optional().allow(''),
    })
  ),
  uploadController.updateFileMetadata
);

// Delete file
router.delete(
  "/file",
  validateBody(
    Joi.object({
      fileKey: Joi.string().required(),
      caseId: Joi.string().optional(),
    })
  ),
  uploadController.deleteFile
);

// Bulk delete files
router.delete(
  "/files/bulk",
  validateBody(
    Joi.object({
      fileKeys: Joi.array().items(Joi.string()).min(1).required(),
      caseId: Joi.string().optional(),
    })
  ),
  uploadController.bulkDeleteFiles
);

// Get files for a case - ✅ UPDATED with search parameter
router.get(
  "/cases/:caseId/files",
  validateQuery(
    Joi.object({
      captureType: Joi.string().valid("screenshot", "video").optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().valid('name', 'size', 'date').default('date'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
      // ✅ NEW: Add search parameter
      search: Joi.string().min(2).max(100).optional(),
    })
  ),
  uploadController.getCaseFiles
);

// ✅ NEW: Search files across all cases
router.get(
  "/search",
  validateQuery(
    Joi.object({
      query: Joi.string().min(2).max(100).required(),
      captureType: Joi.string().valid("screenshot", "video").optional(),
      caseId: Joi.string().optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
    })
  ),
  uploadController.searchFiles
);

// ✅ NEW: Get files by source URL
router.get(
  "/source-url/:sourceUrl(*)",
  validateQuery(
    Joi.object({
      caseId: Joi.string().optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
    })
  ),
  uploadController.getFilesBySourceUrl
);

// Get download URL for file
router.get(
  "/download/:fileKey(*)",
  validateQuery(
    Joi.object({
      expiresIn: Joi.number().integer().min(60).max(86400).default(3600),
      download: Joi.boolean().default(false),
      filename: Joi.string().optional()
    })
  ),
  uploadController.getDownloadUrl
);

// Get file details
router.get(
  "/file/:fileKey(*)",
  uploadController.getFileDetails
);

// Get upload statistics - ✅ UPDATED with new metadata stats
router.get(
  "/stats",
  validateQuery(
    Joi.object({
      caseId: Joi.string().optional(),
      userId: Joi.string().optional(),
      days: Joi.number().integer().min(1).max(365).default(30),
      detailed: Joi.boolean().default(false)
    })
  ),
  uploadController.getUploadStats
);

// Get storage costs estimation
router.get(
  "/costs",
  validateQuery(
    Joi.object({
      caseId: Joi.string().optional(),
      storageClass: Joi.string().valid('STANDARD', 'STANDARD_IA', 'GLACIER', 'DEEP_ARCHIVE').default('STANDARD')
    })
  ),
  uploadController.getStorageCosts
);

// Check file existence
router.head(
  "/file/:fileKey(*)",
  uploadController.checkFileExists
);

// Move file to different storage class
router.patch(
  "/file/:fileKey(*)/storage-class",
  authorizeRole(['admin']),
  validateBody(
    Joi.object({
      storageClass: Joi.string().valid('STANDARD', 'STANDARD_IA', 'GLACIER', 'DEEP_ARCHIVE').required()
    })
  ),
  uploadController.changeStorageClass
);

module.exports = router;