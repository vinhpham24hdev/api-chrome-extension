const s3Utils = require("../utils/s3Utils");
const { files, cases } = require("../utils/mockData");
const { v4: uuidv4 } = require("uuid");

const uploadController = {
  // Generate presigned URL for file upload
  getPresignedUrl: async (req, res, next) => {
    try {
      const {
        fileName,
        fileType,
        caseId,
        captureType,
        fileSize,
        uploadMethod = "PUT",
      } = req.body;
      const userId = req.user.id;

      // Validate file parameters
      const validation = s3Utils.validateFileParams(
        fileName,
        fileType,
        fileSize,
        captureType
      );
      if (!validation.isValid) {
        return res.status(400).json({
          error: "File validation failed",
          details: validation.errors,
          code: "VALIDATION_ERROR",
        });
      }

      // Check if case exists
      const case_ = cases.find((c) => c.id === caseId);
      if (!case_) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      // Generate S3 key
      const s3Key = s3Utils.generateS3Key(
        caseId,
        captureType,
        fileName,
        userId
      );

      // Generate presigned URL
      let result;
      if (uploadMethod === "POST") {
        result = await s3Utils.generatePresignedPost(s3Key, fileType, fileSize);
      } else {
        result = await s3Utils.generatePresignedUrl(s3Key, fileType);
      }

      // Create file metadata record
      const fileMetadata = {
        id: uuidv4(),
        fileName: fileName,
        originalName: fileName,
        fileKey: s3Key,
        fileUrl: result.fileUrl,
        fileType,
        fileSize: fileSize || 0,
        caseId,
        captureType,
        uploadedBy: req.user.username,
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      // Store metadata (will be updated when upload completes)
      files.push(fileMetadata);

      // Response
      res.json({
        uploadUrl: result.uploadUrl,
        fileUrl: result.fileUrl,
        fileName: fileName,
        key: s3Key,
        expiresIn: 3600,
        method: result.method,
        fields: result.fields,
        fileId: fileMetadata.id,
        metadata: {
          caseId,
          captureType,
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Confirm successful upload
  confirmUpload: async (req, res, next) => {
    try {
      const { fileId, fileKey, actualFileSize, checksum } = req.body;

      if (!fileId && !fileKey) {
        return res.status(400).json({
          error: "File ID or file key is required",
          code: "MISSING_IDENTIFIER",
        });
      }

      // Find file metadata
      const fileIndex = files.findIndex(
        (f) => f.id === fileId || f.fileKey === fileKey
      );

      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File metadata not found",
          code: "FILE_NOT_FOUND",
        });
      }

      const file = files[fileIndex];

      // Verify file exists in S3
      const exists = await s3Utils.fileExists(file.fileKey);
      if (!exists) {
        return res.status(400).json({
          error: "File not found in S3",
          code: "S3_FILE_NOT_FOUND",
        });
      }

      // Get actual file metadata from S3
      const s3Metadata = await s3Utils.getFileMetadata(file.fileKey);

      // Update file metadata
      files[fileIndex] = {
        ...file,
        status: "completed",
        fileSize: actualFileSize || s3Metadata.contentLength,
        checksum: checksum,
        uploadedAt: new Date().toISOString(),
        s3Metadata: {
          contentType: s3Metadata.contentType,
          contentLength: s3Metadata.contentLength,
          lastModified: s3Metadata.lastModified,
          etag: s3Metadata.etag,
        },
      };

      // Update case metadata
      const caseIndex = cases.findIndex((c) => c.id === file.caseId);
      if (caseIndex !== -1) {
        const case_ = cases[caseIndex];
        const isScreenshot = file.captureType === "screenshot";

        cases[caseIndex] = {
          ...case_,
          metadata: {
            ...case_.metadata,
            totalScreenshots: isScreenshot
              ? (case_.metadata.totalScreenshots || 0) + 1
              : case_.metadata.totalScreenshots || 0,
            totalVideos: !isScreenshot
              ? (case_.metadata.totalVideos || 0) + 1
              : case_.metadata.totalVideos || 0,
            totalFileSize:
              (case_.metadata.totalFileSize || 0) +
              (actualFileSize || s3Metadata.contentLength),
            lastActivity: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
      }

      res.json({
        success: true,
        file: files[fileIndex],
        message: "Upload confirmed successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete file
  deleteFile: async (req, res, next) => {
    try {
      const { fileKey, caseId } = req.body;

      if (!fileKey) {
        return res.status(400).json({
          error: "File key is required",
          code: "MISSING_FILE_KEY",
        });
      }

      // Find file metadata
      const fileIndex = files.findIndex((f) => f.fileKey === fileKey);
      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File metadata not found",
          code: "FILE_NOT_FOUND",
        });
      }

      const file = files[fileIndex];

      // Check permissions
      if (file.uploadedBy !== req.user.username && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Insufficient permissions to delete this file",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Delete from S3
      await s3Utils.deleteFile(fileKey);

      // Remove from metadata array
      files.splice(fileIndex, 1);

      // Update case metadata
      if (caseId) {
        const caseIndex = cases.findIndex((c) => c.id === caseId);
        if (caseIndex !== -1) {
          const case_ = cases[caseIndex];
          const isScreenshot = file.captureType === "screenshot";

          cases[caseIndex] = {
            ...case_,
            metadata: {
              ...case_.metadata,
              totalScreenshots: isScreenshot
                ? Math.max(0, (case_.metadata.totalScreenshots || 0) - 1)
                : case_.metadata.totalScreenshots || 0,
              totalVideos: !isScreenshot
                ? Math.max(0, (case_.metadata.totalVideos || 0) - 1)
                : case_.metadata.totalVideos || 0,
              totalFileSize: Math.max(
                0,
                (case_.metadata.totalFileSize || 0) - file.fileSize
              ),
              lastActivity: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          };
        }
      }

      res.json({
        success: true,
        message: "File deleted successfully",
        deletedFile: {
          fileKey: file.fileKey,
          fileName: file.fileName,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Get files for a case
  getCaseFiles: async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const { captureType, page = 1, limit = 20 } = req.query;

      // Check if case exists
      const case_ = cases.find((c) => c.id === caseId);
      if (!case_) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      // Filter files
      let caseFiles = files.filter(
        (f) => f.caseId === caseId && f.status === "completed"
      );

      if (captureType) {
        caseFiles = caseFiles.filter((f) => f.captureType === captureType);
      }

      // Sort by upload date (newest first)
      caseFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedFiles = caseFiles.slice(startIndex, endIndex);

      // Generate download URLs for recent files
      const filesWithDownloadUrls = await Promise.all(
        paginatedFiles.map(async (file) => {
          try {
            const downloadUrl = await s3Utils.generateDownloadUrl(
              file.fileKey,
              3600
            );
            return {
              ...file,
              downloadUrl,
              downloadExpires: new Date(Date.now() + 3600 * 1000).toISOString(),
            };
          } catch (error) {
            console.error(
              `Failed to generate download URL for ${file.fileKey}:`,
              error
            );
            return file;
          }
        })
      );

      res.json({
        files: filesWithDownloadUrls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: caseFiles.length,
          totalPages: Math.ceil(caseFiles.length / limit),
          hasNext: endIndex < caseFiles.length,
          hasPrev: page > 1,
        },
        summary: {
          totalFiles: caseFiles.length,
          screenshots: caseFiles.filter((f) => f.captureType === "screenshot")
            .length,
          videos: caseFiles.filter((f) => f.captureType === "video").length,
          totalSize: caseFiles.reduce((sum, f) => sum + f.fileSize, 0),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Get file download URL
  getDownloadUrl: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { expiresIn = 3600 } = req.query;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Generate download URL
      const downloadUrl = await s3Utils.generateDownloadUrl(
        fileKey,
        parseInt(expiresIn)
      );

      res.json({
        downloadUrl,
        fileName: file.fileName,
        fileSize: file.fileSize,
        fileType: file.fileType,
        expiresIn: parseInt(expiresIn),
        expiresAt: new Date(
          Date.now() + parseInt(expiresIn) * 1000
        ).toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },

  // Get upload statistics
  getUploadStats: async (req, res, next) => {
    try {
      const { caseId, userId, days = 30 } = req.query;

      let filteredFiles = files.filter((f) => f.status === "completed");

      // Apply filters
      if (caseId) {
        filteredFiles = filteredFiles.filter((f) => f.caseId === caseId);
      }

      if (userId) {
        filteredFiles = filteredFiles.filter((f) => f.uploadedBy === userId);
      }

      // Date filter
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
      filteredFiles = filteredFiles.filter(
        (f) => new Date(f.uploadedAt) >= cutoffDate
      );

      const stats = {
        totalFiles: filteredFiles.length,
        totalSize: filteredFiles.reduce((sum, f) => sum + f.fileSize, 0),
        byType: {
          screenshot: filteredFiles.filter(
            (f) => f.captureType === "screenshot"
          ).length,
          video: filteredFiles.filter((f) => f.captureType === "video").length,
        },
        byCaseId: {},
        byUser: {},
        recentUploads: filteredFiles
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
          .slice(0, 10)
          .map((f) => ({
            id: f.id,
            fileName: f.fileName,
            caseId: f.caseId,
            captureType: f.captureType,
            fileSize: f.fileSize,
            uploadedBy: f.uploadedBy,
            uploadedAt: f.uploadedAt,
          })),
        uploadsByDay: getUploadsByDay(filteredFiles, parseInt(days)),
      };

      // Group by case
      filteredFiles.forEach((file) => {
        stats.byCaseId[file.caseId] = (stats.byCaseId[file.caseId] || 0) + 1;
      });

      // Group by user
      filteredFiles.forEach((file) => {
        stats.byUser[file.uploadedBy] =
          (stats.byUser[file.uploadedBy] || 0) + 1;
      });

      res.json(stats);
    } catch (error) {
      next(error);
    }
  },
};

// Helper function to get uploads by day
function getUploadsByDay(files, days) {
  const uploadsByDay = {};

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split("T")[0];
    uploadsByDay[dateKey] = 0;
  }

  files.forEach((file) => {
    const dateKey = file.uploadedAt.split("T")[0];
    if (uploadsByDay.hasOwnProperty(dateKey)) {
      uploadsByDay[dateKey]++;
    }
  });

  return uploadsByDay;
}

module.exports = uploadController;
