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
        uploadMethod,
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
        headers: result.headers,
        fileId: fileMetadata.id,
        metadata: {
          caseId,
          captureType,
          userId: req.user.id,
        },
      });
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      next(error);
    }
  },

  // Confirm successful upload
  confirmUpload: async (req, res, next) => {
    try {
      const { fileId, fileKey, actualFileSize, checksum, uploadMethod } = req.body;

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
        files[fileIndex].status = 'failed';
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
        uploadMethod: uploadMethod || file.uploadMethod,
        s3Metadata: {
          contentType: s3Metadata.contentType,
          contentLength: s3Metadata.contentLength,
          lastModified: s3Metadata.lastModified,
          etag: s3Metadata.etag,
          serverSideEncryption: s3Metadata.serverSideEncryption,
          storageClass: s3Metadata.storageClass,
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
      console.error('Error confirming upload:', error);
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
      if (caseId || file.caseId) {
        const targetCaseId = caseId || file.caseId;
        const caseIndex = cases.findIndex((c) => c.id === targetCaseId);
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
      console.error('Error deleting file:', error);
      next(error);
    }
  },

  // Bulk delete files
  bulkDeleteFiles: async (req, res, next) => {
    try {
      const { fileKeys, caseId } = req.body;
      const deletedFiles = [];
      const errors = [];

      for (const fileKey of fileKeys) {
        try {
          const fileIndex = files.findIndex((f) => f.fileKey === fileKey);
          if (fileIndex === -1) {
            errors.push({ fileKey, error: "File not found" });
            continue;
          }

          const file = files[fileIndex];

          // Check permissions
          if (file.uploadedBy !== req.user.username && req.user.role !== "admin") {
            errors.push({ fileKey, error: "Insufficient permissions" });
            continue;
          }

          // Delete from S3
          await s3Utils.deleteFile(fileKey);
          
          // Remove from metadata
          files.splice(fileIndex, 1);
          deletedFiles.push({
            fileKey: file.fileKey,
            fileName: file.fileName,
          });

          // Update case metadata
          if (caseId || file.caseId) {
            const targetCaseId = caseId || file.caseId;
            const caseIndex = cases.findIndex((c) => c.id === targetCaseId);
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
        } catch (error) {
          errors.push({ fileKey, error: error.message });
        }
      }

      res.json({
        success: true,
        message: `Bulk delete completed. ${deletedFiles.length} files deleted, ${errors.length} errors`,
        deletedFiles,
        errors,
        stats: {
          total: fileKeys.length,
          deleted: deletedFiles.length,
          failed: errors.length,
        },
      });
    } catch (error) {
      console.error('Error bulk deleting files:', error);
      next(error);
    }
  },

  // Get files for a case
  getCaseFiles: async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const { captureType, page = 1, limit = 20, sortBy = 'date', sortOrder = 'desc' } = req.query;

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

      // Sort files
      caseFiles.sort((a, b) => {
        let aValue, bValue;
        
        switch (sortBy) {
          case 'name':
            aValue = a.fileName.toLowerCase();
            bValue = b.fileName.toLowerCase();
            break;
          case 'size':
            aValue = a.fileSize;
            bValue = b.fileSize;
            break;
          case 'date':
          default:
            aValue = new Date(a.uploadedAt || a.createdAt);
            bValue = new Date(b.uploadedAt || b.createdAt);
            break;
        }

        if (sortOrder === 'desc') {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        } else {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        }
      });

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedFiles = caseFiles.slice(startIndex, endIndex);

      // Generate download URLs for files
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
        sorting: {
          sortBy,
          sortOrder,
        },
      });
    } catch (error) {
      console.error('Error getting case files:', error);
      next(error);
    }
  },

  // Get file download URL
  getDownloadUrl: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { expiresIn = 3600, download = false, filename } = req.query;

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
        parseInt(expiresIn),
        download ? (filename || file.originalName) : null
      );

      res.json({
        downloadUrl,
        fileName: file.fileName,
        originalName: file.originalName,
        fileSize: file.fileSize,
        fileType: file.fileType,
        expiresIn: parseInt(expiresIn),
        expiresAt: new Date(
          Date.now() + parseInt(expiresIn) * 1000
        ).toISOString(),
      });
    } catch (error) {
      console.error('Error getting download URL:', error);
      next(error);
    }
  },

  // Get file details
  getFileDetails: async (req, res, next) => {
    try {
      const { fileKey } = req.params;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Get S3 metadata
      const s3Metadata = await s3Utils.getFileMetadata(fileKey);

      res.json({
        ...file,
        s3Metadata,
        storageStats: s3Utils.calculateStorageCosts(file.fileSize),
      });
    } catch (error) {
      console.error('Error getting file details:', error);
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
          'Content-Length': metadata.contentLength,
          'Content-Type': metadata.contentType,
          'Last-Modified': metadata.lastModified,
          'ETag': metadata.etag,
        });
        res.status(200).end();
      } else {
        res.status(404).end();
      }
    } catch (error) {
      console.error('Error checking file existence:', error);
      res.status(500).end();
    }
  },

  // Get upload statistics
  getUploadStats: async (req, res, next) => {
    try {
      const { caseId, userId, days = 30, detailed = false } = req.query;

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
        (f) => new Date(f.uploadedAt || f.createdAt) >= cutoffDate
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
          .sort((a, b) => new Date(b.uploadedAt || b.createdAt) - new Date(a.uploadedAt || a.createdAt))
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

      // Add detailed stats if requested
      if (detailed) {
        stats.detailed = {
          averageFileSize: stats.totalFiles > 0 ? stats.totalSize / stats.totalFiles : 0,
          largestFile: filteredFiles.reduce((max, f) => f.fileSize > max.fileSize ? f : max, { fileSize: 0 }),
          storageClasses: {},
          uploadMethods: {},
        };

        // Group by storage class and upload method
        filteredFiles.forEach((file) => {
          const storageClass = file.s3Metadata?.storageClass || 'STANDARD';
          const uploadMethod = file.uploadMethod || 'PUT';
          
          stats.detailed.storageClasses[storageClass] = 
            (stats.detailed.storageClasses[storageClass] || 0) + 1;
          stats.detailed.uploadMethods[uploadMethod] = 
            (stats.detailed.uploadMethods[uploadMethod] || 0) + 1;
        });
      }

      res.json(stats);
    } catch (error) {
      console.error('Error getting upload stats:', error);
      next(error);
    }
  },

  // Get storage costs estimation
  getStorageCosts: async (req, res, next) => {
    try {
      const { caseId, storageClass = 'STANDARD' } = req.query;

      let filteredFiles = files.filter((f) => f.status === "completed");

      if (caseId) {
        filteredFiles = filteredFiles.filter((f) => f.caseId === caseId);
      }

      const totalSize = filteredFiles.reduce((sum, f) => sum + f.fileSize, 0);
      const costs = s3Utils.calculateStorageCosts(totalSize, storageClass);

      res.json({
        totalFiles: filteredFiles.length,
        totalSize,
        costs,
        breakdown: {
          perFile: costs.monthly / filteredFiles.length || 0,
          perGB: costs.monthly / costs.sizeGB || 0,
        },
        recommendations: generateStorageRecommendations(totalSize, filteredFiles),
      });
    } catch (error) {
      console.error('Error getting storage costs:', error);
      next(error);
    }
  },

  // Change storage class
  changeStorageClass: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { storageClass } = req.body;

      // Find file metadata
      const fileIndex = files.findIndex((f) => f.fileKey === fileKey);
      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      // Note: In a real implementation, you would use S3's CopyObject API
      // to change storage class. For this mock, we'll just update metadata.
      files[fileIndex].s3Metadata = {
        ...files[fileIndex].s3Metadata,
        storageClass,
      };

      res.json({
        success: true,
        message: `Storage class changed to ${storageClass}`,
        file: files[fileIndex],
      });
    } catch (error) {
      console.error('Error changing storage class:', error);
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
    const dateKey = (file.uploadedAt || file.createdAt).split("T")[0];
    if (uploadsByDay.hasOwnProperty(dateKey)) {
      uploadsByDay[dateKey]++;
    }
  });

  return uploadsByDay;
}

// Helper function to generate storage recommendations
function generateStorageRecommendations(totalSize, files) {
  const recommendations = [];

  if (totalSize > 1024 * 1024 * 1024) { // > 1GB
    recommendations.push({
      type: 'storage_class',
      message: 'Consider moving old files to STANDARD_IA or GLACIER to reduce costs',
      potentialSavings: 'Up to 40% cost reduction'
    });
  }

  const oldFiles = files.filter(f => {
    const fileDate = new Date(f.uploadedAt || f.createdAt);
    const daysDiff = (Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff > 30;
  });

  if (oldFiles.length > 0) {
    recommendations.push({
      type: 'lifecycle',
      message: `${oldFiles.length} files are older than 30 days and could be archived`,
      potentialSavings: 'Up to 70% cost reduction for archived files'
    });
  }

  return recommendations;
}

module.exports = uploadController;