// controllers/uploadController.js - Database Version
const s3Utils = require("../utils/s3Utils");
const File = require("../models/File");
const Case = require("../models/Case");
const { v4: uuidv4 } = require("uuid");

const uploadController = {
  // Generate presigned URL for file upload with full video support
  getPresignedUrl: async (req, res, next) => {
    try {
      const {
        fileName,
        fileType,
        caseId,
        captureType,
        fileSize,
        uploadMethod = "PUT",
        description,
        sourceUrl,
        videoMetadata = {},
        sessionId,
        useMultipart = false,
      } = req.body;
      const userId = req.user.id;

      // Enhanced validation with video support
      const validation = s3Utils.validateFileParams(
        fileName,
        fileType,
        fileSize,
        captureType,
        videoMetadata
      );

      if (!validation.isValid) {
        return res.status(400).json({
          error: "File validation failed",
          details: validation.errors,
          code: "VALIDATION_ERROR",
        });
      }

      // Check if case exists
      const case_ = await Case.findById(caseId);
      if (!case_) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      // Generate S3 key with session support
      const s3Key = s3Utils.generateS3Key(
        caseId,
        captureType,
        fileName,
        userId,
        sessionId
      );

      // Create file metadata record in database
      const fileMetadata = {
        case_id: caseId,
        file_name: fileName,
        original_name: fileName,
        file_key: s3Key,
        file_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
        file_type: fileType,
        file_size: fileSize || 0,
        capture_type: captureType,
        description: description || null,
        source_url: sourceUrl || null,
        uploaded_by: req.user.id,
        video_metadata: captureType === "video" ? videoMetadata : null,
        session_id: sessionId || null,
        upload_method:
          useMultipart || validation.useMultipart ? "MULTIPART" : uploadMethod,
        multipart_upload_id: null,
      };

      const createdFile = await File.create(fileMetadata);

      let result;

      // Determine upload method
      if (useMultipart || validation.useMultipart) {
        // Initialize multipart upload for large files
        const multipartResult = await s3Utils.initializeMultipartUpload(
          s3Key,
          fileType,
          videoMetadata
        );

        // Update file with multipart upload ID
        await File.updateMultipartUploadId(
          createdFile.id,
          multipartResult.uploadId
        );

        result = {
          uploadUrl: null, // Will be generated per part
          fileUrl: fileMetadata.file_url,
          method: "MULTIPART",
          uploadId: multipartResult.uploadId,
          recommendedChunkSize: validation.recommendedChunkSize,
          maxParts: 10000,
        };
      } else if (uploadMethod === "POST") {
        result = await s3Utils.generatePresignedPost(
          s3Key,
          fileType,
          fileSize,
          3600,
          videoMetadata
        );
      } else {
        result = await s3Utils.generatePresignedUrl(
          s3Key,
          fileType,
          captureType === "video" ? 7200 : 3600,
          videoMetadata
        );
      }

      // Response
      res.json({
        uploadUrl: result.uploadUrl,
        fileUrl: result.fileUrl || fileMetadata.file_url,
        fileName: fileName,
        key: s3Key,
        expiresIn: result.expiresIn || (captureType === "video" ? 7200 : 3600),
        method: result.method || uploadMethod,
        fields: result.fields,
        headers: result.headers,
        fileId: createdFile.id,
        uploadId: result.uploadId,
        recommendedChunkSize: result.recommendedChunkSize,
        metadata: {
          caseId,
          captureType,
          userId: req.user.id,
          description,
          sourceUrl,
          sessionId,
          videoMetadata: captureType === "video" ? videoMetadata : undefined,
        },
        caseId,
      });
    } catch (error) {
      console.error("Error generating presigned URL:", error);
      next(error);
    }
  },

  // Get multipart part URLs for ongoing uploads
  getMultipartPartUrls: async (req, res, next) => {
    try {
      const { fileId, startPart, endPart } = req.body;

      // Find file metadata in database
      const file = await File.findById(fileId);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (!file.multipart_upload_id) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      const partUrls = [];
      for (let partNumber = startPart; partNumber <= endPart; partNumber++) {
        const partUrl = await s3Utils.generateMultipartPartUrl(
          file.file_key,
          file.multipart_upload_id,
          partNumber,
          7200 // 2 hours for video uploads
        );
        partUrls.push(partUrl);
      }

      res.json({
        success: true,
        fileId,
        uploadId: file.multipart_upload_id,
        partUrls,
        expiresIn: 7200,
      });
    } catch (error) {
      console.error("Error generating multipart part URLs:", error);
      next(error);
    }
  },

  // Complete multipart upload
  completeMultipartUpload: async (req, res, next) => {
    try {
      const { fileId, parts } = req.body;

      // Find file metadata in database
      const file = await File.findById(fileId);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (!file.multipart_upload_id) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      // Complete multipart upload
      const result = await s3Utils.completeMultipartUpload(
        file.file_key,
        file.multipart_upload_id,
        parts
      );

      // Get actual file metadata from S3
      const s3Metadata = await s3Utils.getFileMetadata(file.file_key);

      // Update file in database
      const updatedFile = await File.confirmUpload(fileId, {
        actualFileSize: s3Metadata.contentLength,
        s3Metadata: {
          contentType: s3Metadata.contentType,
          contentLength: s3Metadata.contentLength,
          lastModified: s3Metadata.lastModified,
          etag: s3Metadata.etag,
          serverSideEncryption: s3Metadata.serverSideEncryption,
          storageClass: s3Metadata.storageClass,
        },
      });

      // Update case metadata
      await updateCaseMetadata(
        file.case_id,
        file.capture_type,
        s3Metadata.contentLength
      );

      res.json({
        success: true,
        file: updatedFile,
        s3Result: result,
        message: "Multipart upload completed successfully",
      });
    } catch (error) {
      console.error("Error completing multipart upload:", error);
      next(error);
    }
  },

  // Abort multipart upload
  abortMultipartUpload: async (req, res, next) => {
    try {
      const { fileId } = req.body;

      // Find file metadata in database
      const file = await File.findById(fileId);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (!file.multipart_upload_id) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      // Abort multipart upload
      await s3Utils.abortMultipartUpload(
        file.file_key,
        file.multipart_upload_id
      );

      // Update file status in database
      await File.updateStatus(fileId, "failed");

      res.json({
        success: true,
        message: "Multipart upload aborted successfully",
      });
    } catch (error) {
      console.error("Error aborting multipart upload:", error);
      next(error);
    }
  },

  // Confirm successful upload with video support
  confirmUpload: async (req, res, next) => {
    try {
      const {
        fileId,
        fileKey,
        actualFileSize,
        checksum,
        caseId,
        description,
        sourceUrl,
        videoMetadata = {},
        processingRequests = [],
      } = req.body;

      if (!fileId && !fileKey) {
        return res.status(400).json({
          error: "File ID or file key is required",
          code: "MISSING_IDENTIFIER",
        });
      }

      // Find file metadata in database
      let file;
      if (fileId) {
        file = await File.findById(fileId);
      } else {
        file = await File.findByKey(fileKey);
      }

      if (!file) {
        return res.status(404).json({
          error: "File metadata not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Verify file exists in S3
      const exists = await s3Utils.fileExists(file.file_key);
      if (!exists) {
        await File.updateStatus(file.id, "failed");
        return res.status(400).json({
          error: "File not found in S3",
          code: "S3_FILE_NOT_FOUND",
        });
      }

      // Get actual file metadata from S3
      const s3Metadata = await s3Utils.getFileMetadata(file.file_key);

      // Update file in database
      const updatedFile = await File.confirmUpload(file.id, {
        actualFileSize: actualFileSize || s3Metadata.contentLength,
        checksum: checksum,
        s3Metadata: {
          contentType: s3Metadata.contentType,
          contentLength: s3Metadata.contentLength,
          lastModified: s3Metadata.lastModified,
          etag: s3Metadata.etag,
          serverSideEncryption: s3Metadata.serverSideEncryption,
          storageClass: s3Metadata.storageClass,
        },
      });

      await updateCaseMetadata(
        caseId,
        file.capture_type,
        actualFileSize || s3Metadata.contentLength
      );

      res.json({
        success: true,
        file: updatedFile,
        message: "Upload confirmed successfully",
      });
    } catch (error) {
      console.error("Error confirming upload:", error);
      next(error);
    }
  },

  // Update file metadata
  updateFileMetadata: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { description, sourceUrl, videoMetadata } = req.body;

      // Find file metadata in database
      const file = await File.findByKey(fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Check permissions
      if (file.uploaded_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Insufficient permissions to update this file",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Update metadata in database
      const metadataUpdate = {};
      if (description !== undefined) metadataUpdate.description = description;
      if (sourceUrl !== undefined) metadataUpdate.source_url = sourceUrl;
      if (file.capture_type === "video" && videoMetadata) {
        metadataUpdate.video_metadata = {
          ...file.video_metadata,
          ...videoMetadata,
        };
      }

      const updatedFile = await File.updateMetadata(file.id, metadataUpdate);

      res.json({
        success: true,
        file: updatedFile,
        message: "File metadata updated successfully",
      });
    } catch (error) {
      console.error("Error updating file metadata:", error);
      next(error);
    }
  },

  // Delete file with multipart cleanup
  deleteFile: async (req, res, next) => {
    try {
      const { fileKey, caseId } = req.body;

      if (!fileKey) {
        return res.status(400).json({
          error: "File key is required",
          code: "MISSING_FILE_KEY",
        });
      }

      // Find file metadata in database
      const file = await File.findByKey(fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File metadata not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Check permissions
      if (file.uploaded_by !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Insufficient permissions to delete this file",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Abort multipart upload if still in progress
      if (file.multipart_upload_id) {
        try {
          await s3Utils.abortMultipartUpload(
            file.file_key,
            file.multipart_upload_id
          );
        } catch (error) {
          console.warn(`Failed to abort multipart upload: ${error.message}`);
        }
      }

      // Delete from S3
      await s3Utils.deleteFile(fileKey);

      // Delete from database
      const deletedFile = await File.delete(fileKey);

      // Update case metadata
      await updateCaseMetadata(
        caseId || file.case_id,
        file.capture_type,
        -file.file_size
      );

      res.json({
        success: true,
        message: "File deleted successfully",
        deletedFile: {
          fileKey: file.file_key,
          fileName: file.file_name,
          description: file.description,
          sourceUrl: file.source_url,
          captureType: file.capture_type,
          fileSize: file.file_size,
        },
      });
    } catch (error) {
      console.error("Error deleting file:", error);
      next(error);
    }
  },

  // Get files for a case with advanced video filtering
  getCaseFiles: async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const {
        captureType,
        page = 1,
        limit = 20,
        sortBy = "date",
        sortOrder = "desc",
        search,
        videoDuration,
        videoResolution,
        videoCodec,
        hasAudio,
      } = req.query;

      // Check if case exists
      const case_ = await Case.findById(caseId);
      if (!case_) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      // Build filters for database query
      const filters = {
        captureType,
        page: parseInt(page),
        limit: parseInt(limit),
        sortBy,
        sortOrder,
        search,
        videoDuration,
        videoResolution,
        videoCodec,
        hasAudio,
      };

      const caseFiles = await File.findByCaseId(caseId, filters);

      // Generate download URLs for files
      const filesWithDownloadUrls = await Promise.all(
        caseFiles.map(async (file) => {
          try {
            const downloadUrl = await s3Utils.generateDownloadUrl(
              file.file_key,
              3600
            );
            return {
              ...file,
              downloadUrl,
              downloadExpires: new Date(Date.now() + 3600 * 1000).toISOString(),
            };
          } catch (error) {
            console.error(
              `Failed to generate download URL for ${file.file_key}:`,
              error
            );
            return file;
          }
        })
      );

      // Get summary statistics
      const summary = await File.getCaseFilesSummary(caseId, filters);

      res.json({
        files: filesWithDownloadUrls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: summary.total,
          totalPages: Math.ceil(summary.total / limit),
          hasNext: page * limit < summary.total,
          hasPrev: page > 1,
        },
        summary,
        sorting: {
          sortBy,
          sortOrder,
        },
        filters: {
          search: search || null,
          captureType,
          videoDuration,
          videoResolution,
          videoCodec,
          hasAudio,
        },
      });
    } catch (error) {
      console.error("Error getting case files:", error);
      next(error);
    }
  },

  // Search files with video support
  searchFiles: async (req, res, next) => {
    try {
      const {
        query: searchQuery,
        captureType,
        caseId,
        page = 1,
        limit = 20,
        videoDuration,
        videoResolution,
        videoCodec,
        hasAudio,
      } = req.query;

      if (!searchQuery || searchQuery.trim().length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters",
          code: "INVALID_SEARCH_QUERY",
        });
      }

      const filters = {
        captureType,
        caseId,
        page: parseInt(page),
        limit: parseInt(limit),
        videoDuration,
        videoResolution,
        videoCodec,
        hasAudio,
      };

      const searchResults = await File.searchFiles(searchQuery, filters);
      const summary = await File.getSearchSummary(searchQuery, filters);

      res.json({
        results: searchResults,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: summary.total,
          totalPages: Math.ceil(summary.total / limit),
          hasNext: page * limit < summary.total,
          hasPrev: page > 1,
        },
        query: searchQuery,
        summary,
        filters: {
          captureType,
          caseId,
          videoDuration,
          videoResolution,
          videoCodec,
          hasAudio,
        },
      });
    } catch (error) {
      console.error("Error searching files:", error);
      next(error);
    }
  },

  // Get files by source URL
  getFilesBySourceUrl: async (req, res, next) => {
    try {
      const { sourceUrl } = req.params;
      const { caseId, page = 1, limit = 20, captureType } = req.query;

      if (!sourceUrl) {
        return res.status(400).json({
          error: "Source URL is required",
          code: "MISSING_SOURCE_URL",
        });
      }

      const filters = {
        caseId,
        page: parseInt(page),
        limit: parseInt(limit),
        captureType,
      };

      const urlFiles = await File.getFilesBySourceUrl(
        decodeURIComponent(sourceUrl),
        filters
      );
      const summary = await File.getSourceUrlSummary(
        decodeURIComponent(sourceUrl),
        filters
      );

      res.json({
        files: urlFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: summary.total,
          totalPages: Math.ceil(summary.total / limit),
          hasNext: page * limit < summary.total,
          hasPrev: page > 1,
        },
        sourceUrl: decodeURIComponent(sourceUrl),
        summary,
      });
    } catch (error) {
      console.error("Error getting files by source URL:", error);
      next(error);
    }
  },

  // Get files by session ID (for related video recordings)
  getFilesBySession: async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const {
        caseId,
        page = 1,
        limit = 20,
        sortBy = "date",
        sortOrder = "desc",
      } = req.query;

      const filters = {
        caseId,
        page: parseInt(page),
        limit: parseInt(limit),
        sortBy,
        sortOrder,
      };

      const sessionFiles = await File.getFilesBySession(sessionId, filters);
      const summary = await File.getSessionSummary(sessionId, filters);

      res.json({
        files: sessionFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: summary.total,
          totalPages: Math.ceil(summary.total / limit),
          hasNext: page * limit < summary.total,
          hasPrev: page > 1,
        },
        sessionId,
        summary,
        sorting: {
          sortBy,
          sortOrder,
        },
      });
    } catch (error) {
      console.error("Error getting files by session:", error);
      next(error);
    }
  },

  // Get download URL with video optimization
  getDownloadUrl: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const {
        expiresIn = 3600,
        download = false,
        filename,
        quality = "original",
        format = "original",
      } = req.query;

      // Find file metadata in database
      const file = await File.findByKey(fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      let actualFileKey = fileKey;

      // Handle video quality/format conversion for future implementation
      if (
        file.capture_type === "video" &&
        (quality !== "original" || format !== "original")
      ) {
        // TODO: Implement video transcoding logic
        console.log(`Video conversion requested: ${quality}, ${format}`);
        // For now, use original file
      }

      // Generate download URL
      const downloadUrl = await s3Utils.generateDownloadUrl(
        actualFileKey,
        parseInt(expiresIn),
        download ? filename || file.original_name : null
      );

      res.json({
        downloadUrl,
        fileName: file.file_name,
        originalName: file.original_name,
        description: file.description,
        sourceUrl: file.source_url,
        fileSize: file.file_size,
        fileType: file.file_type,
        captureType: file.capture_type,
        videoMetadata: file.video_metadata,
        expiresIn: parseInt(expiresIn),
        expiresAt: new Date(
          Date.now() + parseInt(expiresIn) * 1000
        ).toISOString(),
        requestedQuality: quality,
        requestedFormat: format,
      });
    } catch (error) {
      console.error("Error getting download URL:", error);
      next(error);
    }
  },

  // Get upload statistics with comprehensive video metrics
  getUploadStats: async (req, res, next) => {
    try {
      const {
        caseId,
        userId,
        days = 30,
        detailed = false,
        captureType,
        includeVideoMetrics = true,
      } = req.query;

      const filters = {
        caseId,
        userId,
        days: parseInt(days),
        captureType,
      };

      const stats = await File.getStats(filters);

      // Add detailed stats if requested
      if (detailed) {
        const detailedStats = await File.getDetailedStats(filters);
        stats.detailed = detailedStats;
      }

      // Add video-specific metrics
      if (includeVideoMetrics && captureType !== "screenshot") {
        const videoStats = await File.getVideoStats(filters);
        stats.videoMetrics = videoStats;
      }

      res.json(stats);
    } catch (error) {
      console.error("Error getting upload stats:", error);
      next(error);
    }
  },

  // Get file details
  getFileDetails: async (req, res, next) => {
    try {
      const { fileKey } = req.params;

      // Find file metadata in database
      const file = await File.findByKey(fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Get S3 metadata
      const s3Metadata = await s3Utils.getFileMetadata(fileKey);

      // Enhanced response with video metadata
      const response = {
        ...file,
        s3Metadata,
        storageStats: s3Utils.calculateStorageCosts(
          file.file_size,
          s3Metadata.storageClass,
          file.capture_type === "video"
        ),
      };

      // Add video-specific details
      if (file.capture_type === "video") {
        response.videoAnalysis = {
          estimatedBandwidth: calculateVideoBandwidth(file),
          storageOptimization: getVideoStorageRecommendations(file),
          streamingCompatibility: getStreamingCompatibility(file),
        };
      }

      res.json(response);
    } catch (error) {
      console.error("Error getting file details:", error);
      next(error);
    }
  },

  // Check file existence
  checkFileExists: async (req, res, next) => {
    try {
      const { fileKey } = req.params;

      const exists = await s3Utils.fileExists(fileKey);

      if (exists) {
        const metadata = await s3Utils.getFileMetadata(fileKey);
        res.set({
          "Content-Length": metadata.contentLength,
          "Content-Type": metadata.contentType,
          "Last-Modified": metadata.lastModified,
          ETag: metadata.etag,
          "X-Video-Duration": metadata.metadata?.["video-duration"] || "",
          "X-Video-Resolution":
            metadata.metadata?.["video-width"] &&
            metadata.metadata?.["video-height"]
              ? `${metadata.metadata["video-width"]}x${metadata.metadata["video-height"]}`
              : "",
        });
        res.status(200).end();
      } else {
        res.status(404).end();
      }
    } catch (error) {
      console.error("Error checking file existence:", error);
      res.status(500).end();
    }
  },

  // Get storage costs
  getStorageCosts: async (req, res, next) => {
    try {
      const {
        caseId,
        storageClass = "STANDARD",
        includeVideoOptimization = true,
      } = req.query;

      const filters = { caseId };
      const stats = await File.getStats(filters);

      const totalSize = parseInt(stats.total_size || 0);
      const costs = s3Utils.calculateStorageCosts(totalSize, storageClass);

      const response = {
        totalFiles: parseInt(stats.total_files || 0),
        totalSize,
        costs,
        breakdown: {
          perFile: costs.monthly / parseInt(stats.total_files || 1),
          perGB: costs.monthly / costs.sizeGB || 0,
          videos: {
            count: parseInt(stats.videos || 0),
            monthlyCost:
              costs.monthly *
              (parseInt(stats.videos || 0) / parseInt(stats.total_files || 1)),
          },
          screenshots: {
            count: parseInt(stats.screenshots || 0),
            monthlyCost:
              costs.monthly *
              (parseInt(stats.screenshots || 0) /
                parseInt(stats.total_files || 1)),
          },
        },
        recommendations: generateStorageRecommendations(
          totalSize,
          parseInt(stats.total_files || 0)
        ),
      };

      res.json(response);
    } catch (error) {
      console.error("Error getting storage costs:", error);
      next(error);
    }
  },

  // Change storage class
  changeStorageClass: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { storageClass } = req.body;

      // Find file metadata in database
      const file = await File.findByKey(fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Validate storage class for video files
      if (file.capture_type === "video" && storageClass === "DEEP_ARCHIVE") {
        console.warn(
          "DEEP_ARCHIVE not recommended for video files due to long retrieval times"
        );
      }

      // Note: In a real implementation, you would use S3's CopyObject API
      // to change storage class. For this mock, we'll just update metadata.
      await File.updateStorageClass(file.id, storageClass);

      const newCosts = s3Utils.calculateStorageCosts(
        file.file_size,
        storageClass,
        file.capture_type === "video"
      );

      res.json({
        success: true,
        message: `Storage class changed to ${storageClass}`,
        file: { ...file, storage_class: storageClass },
        costImpact: {
          newMonthlyCost: newCosts.monthly,
          previousCost: s3Utils.calculateStorageCosts(
            file.file_size,
            "STANDARD",
            file.capture_type === "video"
          ).monthly,
          savings:
            s3Utils.calculateStorageCosts(
              file.file_size,
              "STANDARD",
              file.capture_type === "video"
            ).monthly - newCosts.monthly,
        },
      });
    } catch (error) {
      console.error("Error changing storage class:", error);
      next(error);
    }
  },

  // Video processing endpoints would go here...
  // generateVideoThumbnail, compressVideo, etc. - same as before but using database
};

// Helper function to update case metadata
async function updateCaseMetadata(caseId, captureType, fileSizeDelta) {
  try {
    const metadata = {};

    if (captureType === "screenshot") {
      metadata.totalScreenshots = fileSizeDelta > 0 ? 1 : -1;
    } else if (captureType === "video") {
      metadata.totalVideos = fileSizeDelta > 0 ? 1 : -1;
    }

    metadata.totalFileSize = fileSizeDelta;
    metadata.lastActivity = new Date().toISOString();

    await Case.updateMetadata(caseId, metadata);
  } catch (error) {
    console.error("Error updating case metadata:", error);
  }
}

// Helper functions for video analysis
function calculateVideoBandwidth(file) {
  if (file.capture_type !== "video" || !file.video_metadata?.duration) {
    return null;
  }

  return {
    bitsPerSecond: (file.file_size * 8) / file.video_metadata.duration,
    mbitsPerSecond:
      (file.file_size * 8) / file.video_metadata.duration / 1000000,
    recommendation: getBandwidthRecommendation(
      (file.file_size * 8) / file.video_metadata.duration
    ),
  };
}

function getBandwidthRecommendation(bps) {
  if (bps < 500000) return "Low quality - suitable for basic documentation";
  if (bps < 2000000) return "Medium quality - good for most screen recordings";
  if (bps < 8000000) return "High quality - excellent for detailed capture";
  return "Very high quality - may be unnecessarily large";
}

function getVideoStorageRecommendations(file) {
  const recommendations = [];

  if (file.file_size > 50 * 1024 * 1024) {
    // > 50MB
    recommendations.push("Consider Standard-IA storage class for cost savings");
  }

  if (file.video_metadata?.duration > 600) {
    // > 10 minutes
    recommendations.push("Long video - consider compression or segmentation");
  }

  const daysSinceUpload =
    (Date.now() - new Date(file.uploaded_at || file.created_at)) /
    (1000 * 60 * 60 * 24);
  if (daysSinceUpload > 30) {
    recommendations.push("Old video - candidate for archival storage");
  }

  return recommendations;
}

function getStreamingCompatibility(file) {
  if (file.capture_type !== "video") return null;

  const codec = file.video_metadata?.codec?.toLowerCase();
  const format = file.file_type?.split("/")[1];

  return {
    webCompatible:
      ["h264", "vp8", "vp9"].includes(codec) &&
      ["mp4", "webm"].includes(format),
    mobileCompatible: codec === "h264" && format === "mp4",
    browserSupport: {
      chrome: ["h264", "vp8", "vp9", "av1"].includes(codec),
      firefox: ["h264", "vp8", "vp9", "av1"].includes(codec),
      safari: ["h264"].includes(codec),
    },
    recommendation: getStreamingRecommendation(codec, format),
  };
}

function getStreamingRecommendation(codec, format) {
  if (codec === "h264" && format === "mp4") {
    return "Optimal for streaming - universally supported";
  }
  if (codec === "vp9" && format === "webm") {
    return "Good for web streaming - modern browser support";
  }
  return "May need transcoding for optimal streaming compatibility";
}

function generateStorageRecommendations(totalSize, fileCount) {
  const recommendations = [];

  if (totalSize > 1024 * 1024 * 1024) {
    // > 1GB
    recommendations.push({
      type: "storage_class",
      message:
        "Consider moving old files to STANDARD_IA or GLACIER to reduce costs",
      potentialSavings: "Up to 40% cost reduction",
    });
  }

  if (fileCount > 1000) {
    recommendations.push({
      type: "lifecycle",
      message: `Large number of files (${fileCount}) - implement lifecycle policies`,
      potentialSavings: "Automated cost optimization",
    });
  }

  return recommendations;
}

module.exports = uploadController;
