// routes/upload.js - Enhanced for Video Recording Support
const express = require("express");
const Joi = require("joi");

const uploadController = require("../controllers/uploadController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");
const {
  validateBody,
  validateQuery,
  schemas,
} = require("../middleware/validation");

const router = express.Router();

// All upload routes require authentication
router.use(authenticateToken);

// ✅ ENHANCED: Get presigned URL for upload with video support
router.post(
  "/presigned-url",
  validateBody(
    Joi.object({
      fileName: Joi.string().required(),
      fileType: Joi.string().required(),
      caseId: Joi.string().required(),
      captureType: Joi.string().valid("screenshot", "video").required(),
      fileSize: Joi.number().positive().optional(),
      uploadMethod: Joi.string().valid('PUT', 'POST', 'MULTIPART').default('PUT'),
      
      // Standard fields
      description: Joi.string().max(1000).optional().allow(''),
      sourceUrl: Joi.string().uri().max(2000).optional().allow(''),
      
      // ✅ NEW: Video-specific fields
      videoMetadata: Joi.object({
        duration: Joi.number().positive().max(1800).optional(), // Max 30 minutes
        width: Joi.number().integer().positive().max(3840).optional(), // Max 4K width
        height: Joi.number().integer().positive().max(2160).optional(), // Max 4K height
        codec: Joi.string().valid('h264', 'h265', 'vp8', 'vp9', 'av1').optional(),
        bitrate: Joi.number().positive().max(50000000).optional(), // Max 50 Mbps
        fps: Joi.number().positive().max(120).optional(), // Max 120 fps
        hasAudio: Joi.boolean().optional().default(false)
      }).optional().default({}),
      
      // ✅ NEW: Session and multipart fields
      sessionId: Joi.string().optional(), // For grouping related recordings
      useMultipart: Joi.boolean().optional().default(false) // Force multipart upload
    })
  ),
  uploadController.getPresignedUrl
);

// ✅ NEW: Get additional multipart part URLs for ongoing uploads
router.post(
  "/multipart/part-urls",
  validateBody(
    Joi.object({
      fileId: Joi.string().required(),
      startPart: Joi.number().integer().min(1).max(10000).required(),
      endPart: Joi.number().integer().min(1).max(10000).required()
    })
  ),
  uploadController.getMultipartPartUrls
);

// ✅ NEW: Complete multipart upload
router.post(
  "/multipart/complete",
  validateBody(
    Joi.object({
      fileId: Joi.string().required(),
      parts: Joi.array().items(
        Joi.object({
          partNumber: Joi.number().integer().min(1).max(10000).required(),
          etag: Joi.string().required()
        })
      ).min(1).required()
    })
  ),
  uploadController.completeMultipartUpload
);

// ✅ NEW: Abort multipart upload
router.post(
  "/multipart/abort",
  validateBody(
    Joi.object({
      fileId: Joi.string().required()
    })
  ),
  uploadController.abortMultipartUpload
);

// ✅ ENHANCED: Confirm successful upload with video support
router.post(
  "/confirm",
  validateBody(
    Joi.object({
      fileId: Joi.string().optional(),
      fileKey: Joi.string().optional(),
      actualFileSize: Joi.number().positive().optional(),
      checksum: Joi.string().optional(),
      uploadMethod: Joi.string().valid('PUT', 'POST', 'MULTIPART').default('PUT'),
      
      // Standard fields
      description: Joi.string().max(1000).optional().allow(''),
      sourceUrl: Joi.string().uri().max(2000).optional().allow(''),
      
      // ✅ NEW: Video-specific confirmation
      videoMetadata: Joi.object({
        duration: Joi.number().positive().optional(),
        width: Joi.number().integer().positive().optional(),
        height: Joi.number().integer().positive().optional(),
        codec: Joi.string().optional(),
        bitrate: Joi.number().positive().optional(),
        fps: Joi.number().positive().optional(),
        hasAudio: Joi.boolean().optional()
      }).optional().default({}),
      
      // ✅ NEW: Processing requests
      processingRequests: Joi.array().items(
        Joi.string().valid('thumbnail', 'metadata', 'compress')
      ).optional().default([])
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
      
      // ✅ NEW: Video metadata updates
      videoMetadata: Joi.object({
        duration: Joi.number().positive().optional(),
        width: Joi.number().integer().positive().optional(),
        height: Joi.number().integer().positive().optional(),
        codec: Joi.string().optional(),
        bitrate: Joi.number().positive().optional(),
        fps: Joi.number().positive().optional(),
        hasAudio: Joi.boolean().optional()
      }).optional()
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

// ✅ ENHANCED: Get files for a case with video filtering
router.get(
  "/cases/:caseId/files",
  validateQuery(
    Joi.object({
      captureType: Joi.string().valid("screenshot", "video").optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().valid('name', 'size', 'date', 'duration', 'resolution').default('date'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
      search: Joi.string().min(2).max(100).optional(),
      
      // ✅ NEW: Video-specific filters
      videoDuration: Joi.string().pattern(/^\d+:\d+$/).optional(), // "min:max" format
      videoResolution: Joi.string().pattern(/^\d+x\d+$/).optional(), // "1920x1080" format
      videoCodec: Joi.string().valid('h264', 'h265', 'vp8', 'vp9', 'av1').optional(),
      hasAudio: Joi.string().valid('true', 'false').optional()
    })
  ),
  uploadController.getCaseFiles
);

// ✅ ENHANCED: Search files across all cases with video support
router.get(
  "/search",
  validateQuery(
    Joi.object({
      query: Joi.string().min(2).max(100).required(),
      captureType: Joi.string().valid("screenshot", "video").optional(),
      caseId: Joi.string().optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      
      // ✅ NEW: Video-specific search filters
      videoDuration: Joi.string().pattern(/^\d+:\d+$/).optional(),
      videoResolution: Joi.string().pattern(/^\d+x\d+$/).optional(),
      videoCodec: Joi.string().valid('h264', 'h265', 'vp8', 'vp9', 'av1').optional(),
      hasAudio: Joi.string().valid('true', 'false').optional()
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
      captureType: Joi.string().valid("screenshot", "video").optional()
    })
  ),
  uploadController.getFilesBySourceUrl
);

// ✅ NEW: Get files by session ID (for related video recordings)
router.get(
  "/session/:sessionId/files",
  validateQuery(
    Joi.object({
      caseId: Joi.string().optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().valid('name', 'size', 'date', 'duration').default('date'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    })
  ),
  uploadController.getFilesBySession
);

// Get download URL for file
router.get(
  "/download/:fileKey(*)",
  validateQuery(
    Joi.object({
      expiresIn: Joi.number().integer().min(60).max(86400).default(3600),
      download: Joi.boolean().default(false),
      filename: Joi.string().optional(),
      // ✅ NEW: Video-specific download options
      quality: Joi.string().valid('original', 'compressed').optional().default('original'),
      format: Joi.string().valid('mp4', 'webm', 'original').optional().default('original')
    })
  ),
  uploadController.getDownloadUrl
);

// Get file details
router.get(
  "/file/:fileKey(*)",
  uploadController.getFileDetails
);

// ✅ ENHANCED: Get upload statistics with video metrics
router.get(
  "/stats",
  validateQuery(
    Joi.object({
      caseId: Joi.string().optional(),
      userId: Joi.string().optional(),
      days: Joi.number().integer().min(1).max(365).default(30),
      detailed: Joi.boolean().default(false),
      
      // ✅ NEW: Video-specific stats filters
      captureType: Joi.string().valid("screenshot", "video").optional(),
      includeVideoMetrics: Joi.boolean().default(true)
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
      storageClass: Joi.string().valid('STANDARD', 'STANDARD_IA', 'GLACIER', 'DEEP_ARCHIVE').default('STANDARD'),
      // ✅ NEW: Video-specific cost analysis
      includeVideoOptimization: Joi.boolean().default(true)
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