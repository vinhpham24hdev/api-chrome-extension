// controllers/uploadController.js - Enhanced for Video Recording Support
const s3Utils = require("../utils/s3Utils");
const { files, cases } = require("../utils/mockData");
const { v4: uuidv4 } = require("uuid");

const uploadController = {
  // ✅ ENHANCED: Generate presigned URL for file upload with full video support
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
        useMultipart = false
      } = req.body;
      const userId = req.user.id;

      // Clean file type by removing codec parameters for validation
      const cleanFileType = fileType.split(';')[0].trim();
      
      // Enhanced validation with video support
      const validation = s3Utils.validateFileParams(
        fileName,
        cleanFileType,
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

      // Extract codec from original fileType if present
      const codecMatch = fileType.match(/codecs=([^;,]+)/i);
      if (codecMatch && captureType === 'video') {
        const detectedCodec = codecMatch[1].replace(/"/g, '').toLowerCase();
        if (!videoMetadata.codec) {
          videoMetadata.codec = detectedCodec;
        }
      }
      
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

      // Generate S3 key with session support
      const s3Key = s3Utils.generateS3Key(
        caseId,
        captureType,
        fileName,
        userId,
        sessionId
      );

      // Create file metadata record
      const fileMetadata = {
        id: uuidv4(),
        fileName: fileName,
        originalName: fileName,
        fileKey: s3Key,
        fileUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
        fileType: cleanFileType, // Use clean file type without codec parameters
        originalFileType: fileType, // Keep original for reference
        fileSize: fileSize || 0,
        caseId,
        captureType,
        description: description || null,
        sourceUrl: sourceUrl || null,
        sessionId: sessionId || null,
        videoMetadata: captureType === 'video' ? videoMetadata : null,
        uploadedBy: req.user.username,
        status: "pending",
        createdAt: new Date().toISOString(),
        uploadMethod: useMultipart || validation.useMultipart ? "MULTIPART" : uploadMethod,
        multipartUploadId: null,
        processingStatus: captureType === 'video' ? 'pending' : null
      };

      let result;

      // Determine upload method
      if (useMultipart || validation.useMultipart) {
        // Initialize multipart upload for large files
        const multipartResult = await s3Utils.initializeMultipartUpload(
          s3Key, 
          fileType, 
          videoMetadata
        );
        
        fileMetadata.multipartUploadId = multipartResult.uploadId;
        fileMetadata.uploadMethod = "MULTIPART";

        result = {
          uploadUrl: null, // Will be generated per part
          fileUrl: fileMetadata.fileUrl,
          method: "MULTIPART",
          uploadId: multipartResult.uploadId,
          recommendedChunkSize: validation.recommendedChunkSize,
          maxParts: 10000
        };
      } else if (uploadMethod === "POST") {
        result = await s3Utils.generatePresignedPost(
          s3Key, 
          cleanFileType, // Use clean file type
          fileSize, 
          3600, 
          videoMetadata
        );
      } else {
        result = await s3Utils.generatePresignedUrl(
          s3Key, 
          cleanFileType, // Use clean file type
          captureType === 'video' ? 7200 : 3600, 
          videoMetadata
        );
      }

      // Store metadata
      files.push(fileMetadata);

      // Response
      res.json({
        uploadUrl: result.uploadUrl,
        fileUrl: result.fileUrl || fileMetadata.fileUrl,
        fileName: fileName,
        key: s3Key,
        expiresIn: result.expiresIn || (captureType === 'video' ? 7200 : 3600),
        method: result.method || uploadMethod,
        fields: result.fields,
        headers: result.headers,
        fileId: fileMetadata.id,
        uploadId: result.uploadId,
        recommendedChunkSize: result.recommendedChunkSize,
        metadata: {
          caseId,
          captureType,
          userId: req.user.id,
          description,
          sourceUrl,
          sessionId,
          videoMetadata: captureType === 'video' ? videoMetadata : undefined
        },
      });
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      next(error);
    }
  },

  // ✅ NEW: Get multipart part URLs for ongoing uploads
  getMultipartPartUrls: async (req, res, next) => {
    try {
      const { fileId, startPart, endPart } = req.body;

      // Find file metadata
      const file = files.find((f) => f.id === fileId);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (!file.multipartUploadId) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      const partUrls = [];
      for (let partNumber = startPart; partNumber <= endPart; partNumber++) {
        const partUrl = await s3Utils.generateMultipartPartUrl(
          file.fileKey,
          file.multipartUploadId,
          partNumber,
          7200 // 2 hours for video uploads
        );
        partUrls.push(partUrl);
      }

      res.json({
        success: true,
        fileId,
        uploadId: file.multipartUploadId,
        partUrls,
        expiresIn: 7200
      });
    } catch (error) {
      console.error('Error generating multipart part URLs:', error);
      next(error);
    }
  },

  // ✅ NEW: Complete multipart upload
  completeMultipartUpload: async (req, res, next) => {
    try {
      const { fileId, parts } = req.body;

      // Find file metadata
      const fileIndex = files.findIndex((f) => f.id === fileId);
      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      const file = files[fileIndex];

      if (!file.multipartUploadId) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      // Complete multipart upload
      const result = await s3Utils.completeMultipartUpload(
        file.fileKey,
        file.multipartUploadId,
        parts
      );

      // Get actual file metadata from S3
      const s3Metadata = await s3Utils.getFileMetadata(file.fileKey);

      // Update file metadata
      files[fileIndex] = {
        ...file,
        status: "completed",
        fileSize: s3Metadata.contentLength,
        uploadedAt: new Date().toISOString(),
        s3Metadata: {
          contentType: s3Metadata.contentType,
          contentLength: s3Metadata.contentLength,
          lastModified: s3Metadata.lastModified,
          etag: s3Metadata.etag,
          serverSideEncryption: s3Metadata.serverSideEncryption,
          storageClass: s3Metadata.storageClass,
        },
        multipartUploadId: null
      };

      // Update case metadata
      await updateCaseMetadata(file.caseId, file.captureType, s3Metadata.contentLength);

      res.json({
        success: true,
        file: files[fileIndex],
        s3Result: result,
        message: "Multipart upload completed successfully",
      });
    } catch (error) {
      console.error('Error completing multipart upload:', error);
      next(error);
    }
  },

  // ✅ NEW: Abort multipart upload
  abortMultipartUpload: async (req, res, next) => {
    try {
      const { fileId } = req.body;

      // Find file metadata
      const fileIndex = files.findIndex((f) => f.id === fileId);
      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      const file = files[fileIndex];

      if (!file.multipartUploadId) {
        return res.status(400).json({
          error: "File is not a multipart upload",
          code: "NOT_MULTIPART_UPLOAD",
        });
      }

      // Abort multipart upload
      await s3Utils.abortMultipartUpload(file.fileKey, file.multipartUploadId);

      // Update file status
      files[fileIndex].status = 'failed';
      files[fileIndex].multipartUploadId = null;

      res.json({
        success: true,
        message: "Multipart upload aborted successfully",
      });
    } catch (error) {
      console.error('Error aborting multipart upload:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Confirm successful upload with video support
  confirmUpload: async (req, res, next) => {
    try {
      const { 
        fileId, 
        fileKey, 
        actualFileSize, 
        checksum, 
        uploadMethod,
        description,
        sourceUrl,
        videoMetadata = {},
        processingRequests = []
      } = req.body;

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

      // Merge video metadata
      const finalVideoMetadata = file.captureType === 'video' ? 
        { ...file.videoMetadata, ...videoMetadata } : null;

      // Update file metadata
      files[fileIndex] = {
        ...file,
        status: "completed",
        fileSize: actualFileSize || s3Metadata.contentLength,
        checksum: checksum,
        description: description !== undefined ? description : file.description,
        sourceUrl: sourceUrl !== undefined ? sourceUrl : file.sourceUrl,
        videoMetadata: finalVideoMetadata,
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
        processingRequests: processingRequests
      };

      // Update case metadata
      await updateCaseMetadata(
        file.caseId, 
        file.captureType, 
        actualFileSize || s3Metadata.contentLength
      );

      // Start video processing if requested
      if (file.captureType === 'video' && processingRequests.length > 0) {
        files[fileIndex].processingStatus = 'processing';
        // TODO: Integrate with video processing service
        console.log(`Video processing requested: ${processingRequests.join(', ')}`);
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

  // ✅ NEW: Get video metadata
  getVideoMetadata: async (req, res, next) => {
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

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // Get video metadata from S3
      const videoInfo = await s3Utils.getVideoMetadata(fileKey);

      res.json({
        fileKey,
        ...videoInfo,
        storedMetadata: file.videoMetadata,
        processingStatus: file.processingStatus || 'completed'
      });
    } catch (error) {
      console.error('Error getting video metadata:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Update file metadata
  updateFileMetadata: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { description, sourceUrl, videoMetadata } = req.body;

      // Find file metadata
      const fileIndex = files.findIndex((f) => f.fileKey === fileKey);
      if (fileIndex === -1) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      const file = files[fileIndex];

      // Check permissions
      if (file.uploadedBy !== req.user.username && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Insufficient permissions to update this file",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Update metadata
      files[fileIndex] = {
        ...file,
        description: description !== undefined ? description : file.description,
        sourceUrl: sourceUrl !== undefined ? sourceUrl : file.sourceUrl,
        videoMetadata: file.captureType === 'video' && videoMetadata ? 
          { ...file.videoMetadata, ...videoMetadata } : file.videoMetadata,
        updatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        file: files[fileIndex],
        message: "File metadata updated successfully",
      });
    } catch (error) {
      console.error('Error updating file metadata:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Delete file with multipart cleanup
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

      // Abort multipart upload if still in progress
      if (file.multipartUploadId) {
        try {
          await s3Utils.abortMultipartUpload(file.fileKey, file.multipartUploadId);
        } catch (error) {
          console.warn(`Failed to abort multipart upload: ${error.message}`);
        }
      }

      // Delete from S3
      await s3Utils.deleteFile(fileKey);

      // Remove from metadata array
      files.splice(fileIndex, 1);

      // Update case metadata
      await updateCaseMetadata(
        caseId || file.caseId, 
        file.captureType, 
        -file.fileSize
      );

      res.json({
        success: true,
        message: "File deleted successfully",
        deletedFile: {
          fileKey: file.fileKey,
          fileName: file.fileName,
          description: file.description,
          sourceUrl: file.sourceUrl,
          captureType: file.captureType,
          fileSize: file.fileSize
        },
      });
    } catch (error) {
      console.error('Error deleting file:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Get files for a case with advanced video filtering
  getCaseFiles: async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const { 
        captureType, 
        page = 1, 
        limit = 20, 
        sortBy = 'date', 
        sortOrder = 'desc',
        search,
        videoDuration,
        videoResolution,
        videoCodec,
        hasAudio
      } = req.query;

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

      // Search functionality
      if (search) {
        const searchLower = search.toLowerCase();
        caseFiles = caseFiles.filter((f) => 
          (f.fileName && f.fileName.toLowerCase().includes(searchLower)) ||
          (f.description && f.description.toLowerCase().includes(searchLower)) ||
          (f.sourceUrl && f.sourceUrl.toLowerCase().includes(searchLower))
        );
      }

      // Video-specific filters
      if (captureType === 'video') {
        if (videoDuration) {
          const [minDuration, maxDuration] = videoDuration.split(':').map(Number);
          caseFiles = caseFiles.filter((f) => {
            const duration = f.videoMetadata?.duration || 0;
            return duration >= minDuration && duration <= maxDuration;
          });
        }

        if (videoResolution) {
          const [width, height] = videoResolution.split('x').map(Number);
          caseFiles = caseFiles.filter((f) => 
            f.videoMetadata?.width === width && f.videoMetadata?.height === height
          );
        }

        if (videoCodec) {
          caseFiles = caseFiles.filter((f) => 
            f.videoMetadata?.codec === videoCodec
          );
        }

        if (hasAudio !== undefined) {
          const hasAudioBool = hasAudio === 'true';
          caseFiles = caseFiles.filter((f) => 
            f.videoMetadata?.hasAudio === hasAudioBool
          );
        }
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
          case 'duration':
            aValue = a.videoMetadata?.duration || 0;
            bValue = b.videoMetadata?.duration || 0;
            break;
          case 'resolution':
            aValue = (a.videoMetadata?.width || 0) * (a.videoMetadata?.height || 0);
            bValue = (b.videoMetadata?.width || 0) * (b.videoMetadata?.height || 0);
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

      const videoFiles = caseFiles.filter((f) => f.captureType === "video");
      const screenshotFiles = caseFiles.filter((f) => f.captureType === "screenshot");

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
          screenshots: screenshotFiles.length,
          videos: videoFiles.length,
          totalSize: caseFiles.reduce((sum, f) => sum + f.fileSize, 0),
          totalDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
          filesWithDescription: caseFiles.filter((f) => f.description && f.description.trim()).length,
          filesWithSourceUrl: caseFiles.filter((f) => f.sourceUrl && f.sourceUrl.trim()).length,
          averageVideoSize: videoFiles.length > 0 ? 
            videoFiles.reduce((sum, f) => sum + f.fileSize, 0) / videoFiles.length : 0,
          videoResolutions: [...new Set(videoFiles
            .map(f => f.videoMetadata?.width && f.videoMetadata?.height ? 
              `${f.videoMetadata.width}x${f.videoMetadata.height}` : null)
            .filter(Boolean))]
        },
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
          hasAudio
        },
      });
    } catch (error) {
      console.error('Error getting case files:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Search files with video support
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
        hasAudio
      } = req.query;

      if (!searchQuery || searchQuery.trim().length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters",
          code: "INVALID_SEARCH_QUERY",
        });
      }

      let searchResults = files.filter((f) => f.status === "completed");

      // Apply search
      const searchLower = searchQuery.toLowerCase();
      searchResults = searchResults.filter((f) => 
        (f.fileName && f.fileName.toLowerCase().includes(searchLower)) ||
        (f.description && f.description.toLowerCase().includes(searchLower)) ||
        (f.sourceUrl && f.sourceUrl.toLowerCase().includes(searchLower)) ||
        (f.originalName && f.originalName.toLowerCase().includes(searchLower)) ||
        (f.videoMetadata?.codec && f.videoMetadata.codec.toLowerCase().includes(searchLower))
      );

      // Apply filters
      if (captureType) {
        searchResults = searchResults.filter((f) => f.captureType === captureType);
      }

      if (caseId) {
        searchResults = searchResults.filter((f) => f.caseId === caseId);
      }

      // Video-specific filters
      if (captureType === 'video') {
        if (videoDuration) {
          const [minDuration, maxDuration] = videoDuration.split(':').map(Number);
          searchResults = searchResults.filter((f) => {
            const duration = f.videoMetadata?.duration || 0;
            return duration >= minDuration && duration <= maxDuration;
          });
        }

        if (videoResolution) {
          const [width, height] = videoResolution.split('x').map(Number);
          searchResults = searchResults.filter((f) => 
            f.videoMetadata?.width === width && f.videoMetadata?.height === height
          );
        }

        if (videoCodec) {
          searchResults = searchResults.filter((f) => 
            f.videoMetadata?.codec === videoCodec
          );
        }

        if (hasAudio !== undefined) {
          const hasAudioBool = hasAudio === 'true';
          searchResults = searchResults.filter((f) => 
            f.videoMetadata?.hasAudio === hasAudioBool
          );
        }
      }

      // Sort by relevance
      searchResults.sort((a, b) => {
        const aScore = getRelevanceScore(a, searchLower);
        const bScore = getRelevanceScore(b, searchLower);
        return bScore - aScore;
      });

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedResults = searchResults.slice(startIndex, endIndex);

      const videoResults = searchResults.filter((f) => f.captureType === "video");

      res.json({
        results: paginatedResults,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: searchResults.length,
          totalPages: Math.ceil(searchResults.length / limit),
          hasNext: endIndex < searchResults.length,
          hasPrev: page > 1,
        },
        query: searchQuery,
        summary: {
          totalMatches: searchResults.length,
          screenshots: searchResults.filter((f) => f.captureType === "screenshot").length,
          videos: videoResults.length,
          totalDuration: videoResults.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
          uniqueCases: [...new Set(searchResults.map(f => f.caseId))].length,
          uniqueSessions: [...new Set(searchResults.map(f => f.sessionId).filter(Boolean))].length
        },
        filters: {
          captureType,
          caseId,
          videoDuration,
          videoResolution,
          videoCodec,
          hasAudio
        }
      });
    } catch (error) {
      console.error('Error searching files:', error);
      next(error);
    }
  },

  // ✅ NEW: Get files by source URL
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

      let urlFiles = files.filter((f) => 
        f.status === "completed" && 
        f.sourceUrl && 
        f.sourceUrl.includes(decodeURIComponent(sourceUrl))
      );

      if (caseId) {
        urlFiles = urlFiles.filter((f) => f.caseId === caseId);
      }

      if (captureType) {
        urlFiles = urlFiles.filter((f) => f.captureType === captureType);
      }

      // Sort by upload date (newest first)
      urlFiles.sort((a, b) => 
        new Date(b.uploadedAt || b.createdAt) - new Date(a.uploadedAt || a.createdAt)
      );

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedFiles = urlFiles.slice(startIndex, endIndex);

      const videoFiles = urlFiles.filter((f) => f.captureType === "video");

      res.json({
        files: paginatedFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: urlFiles.length,
          totalPages: Math.ceil(urlFiles.length / limit),
          hasNext: endIndex < urlFiles.length,
          hasPrev: page > 1,
        },
        sourceUrl: decodeURIComponent(sourceUrl),
        summary: {
          totalFiles: urlFiles.length,
          screenshots: urlFiles.filter((f) => f.captureType === "screenshot").length,
          videos: videoFiles.length,
          totalDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
          uniqueCases: [...new Set(urlFiles.map(f => f.caseId))].length,
          uniqueSessions: [...new Set(urlFiles.map(f => f.sessionId).filter(Boolean))].length,
        },
      });
    } catch (error) {
      console.error('Error getting files by source URL:', error);
      next(error);
    }
  },

  // ✅ NEW: Get files by session ID (for related video recordings)
  getFilesBySession: async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { caseId, page = 1, limit = 20, sortBy = 'date', sortOrder = 'desc' } = req.query;

      let sessionFiles = files.filter((f) => 
        f.status === "completed" && f.sessionId === sessionId
      );

      if (caseId) {
        sessionFiles = sessionFiles.filter((f) => f.caseId === caseId);
      }

      // Sort files
      sessionFiles.sort((a, b) => {
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
          case 'duration':
            aValue = a.videoMetadata?.duration || 0;
            bValue = b.videoMetadata?.duration || 0;
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
      const paginatedFiles = sessionFiles.slice(startIndex, endIndex);

      const videoFiles = sessionFiles.filter((f) => f.captureType === "video");

      res.json({
        files: paginatedFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: sessionFiles.length,
          totalPages: Math.ceil(sessionFiles.length / limit),
          hasNext: endIndex < sessionFiles.length,
          hasPrev: page > 1,
        },
        sessionId,
        summary: {
          totalFiles: sessionFiles.length,
          screenshots: sessionFiles.filter((f) => f.captureType === "screenshot").length,
          videos: videoFiles.length,
          totalSize: sessionFiles.reduce((sum, f) => sum + f.fileSize, 0),
          totalDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
          uniqueCases: [...new Set(sessionFiles.map(f => f.caseId))].length,
          dateRange: {
            start: sessionFiles.length > 0 ? 
              new Date(Math.min(...sessionFiles.map(f => new Date(f.createdAt)))).toISOString() : null,
            end: sessionFiles.length > 0 ? 
              new Date(Math.max(...sessionFiles.map(f => new Date(f.uploadedAt || f.createdAt)))).toISOString() : null
          }
        },
        sorting: {
          sortBy,
          sortOrder,
        },
      });
    } catch (error) {
      console.error('Error getting files by session:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Get download URL with video optimization
  getDownloadUrl: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { expiresIn = 3600, download = false, filename, quality = 'original', format = 'original' } = req.query;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      let actualFileKey = fileKey;

      // Handle video quality/format conversion for future implementation
      if (file.captureType === 'video' && (quality !== 'original' || format !== 'original')) {
        // TODO: Implement video transcoding logic
        console.log(`Video conversion requested: ${quality}, ${format}`);
        // For now, use original file
      }

      // Generate download URL
      const downloadUrl = await s3Utils.generateDownloadUrl(
        actualFileKey,
        parseInt(expiresIn),
        download ? (filename || file.originalName) : null
      );

      res.json({
        downloadUrl,
        fileName: file.fileName,
        originalName: file.originalName,
        description: file.description,
        sourceUrl: file.sourceUrl,
        fileSize: file.fileSize,
        fileType: file.fileType,
        captureType: file.captureType,
        videoMetadata: file.videoMetadata,
        expiresIn: parseInt(expiresIn),
        expiresAt: new Date(
          Date.now() + parseInt(expiresIn) * 1000
        ).toISOString(),
        requestedQuality: quality,
        requestedFormat: format,
      });
    } catch (error) {
      console.error('Error getting download URL:', error);
      next(error);
    }
  },

  // ✅ ENHANCED: Get upload statistics with comprehensive video metrics
  getUploadStats: async (req, res, next) => {
    try {
      const { 
        caseId, 
        userId, 
        days = 30, 
        detailed = false, 
        captureType,
        includeVideoMetrics = true 
      } = req.query;

      let filteredFiles = files.filter((f) => f.status === "completed");

      // Apply filters
      if (caseId) {
        filteredFiles = filteredFiles.filter((f) => f.caseId === caseId);
      }

      if (userId) {
        filteredFiles = filteredFiles.filter((f) => f.uploadedBy === userId);
      }

      if (captureType) {
        filteredFiles = filteredFiles.filter((f) => f.captureType === captureType);
      }

      // Date filter
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
      filteredFiles = filteredFiles.filter(
        (f) => new Date(f.uploadedAt || f.createdAt) >= cutoffDate
      );

      const videoFiles = filteredFiles.filter((f) => f.captureType === "video");
      const screenshotFiles = filteredFiles.filter((f) => f.captureType === "screenshot");

      const stats = {
        totalFiles: filteredFiles.length,
        totalSize: filteredFiles.reduce((sum, f) => sum + f.fileSize, 0),
        byType: {
          screenshot: screenshotFiles.length,
          video: videoFiles.length,
        },
        withMetadata: {
          description: filteredFiles.filter((f) => f.description && f.description.trim()).length,
          sourceUrl: filteredFiles.filter((f) => f.sourceUrl && f.sourceUrl.trim()).length,
          both: filteredFiles.filter((f) => 
            f.description && f.description.trim() && 
            f.sourceUrl && f.sourceUrl.trim()
          ).length,
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
            description: f.description,
            sourceUrl: f.sourceUrl,
            sessionId: f.sessionId,
            duration: f.videoMetadata?.duration || null
          })),
        uploadsByDay: getUploadsByDay(filteredFiles, parseInt(days)),
      };

      // Video-specific metrics
      if (includeVideoMetrics && videoFiles.length > 0) {
        stats.videoMetrics = {
          totalVideos: videoFiles.length,
          totalDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
          averageDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0) / videoFiles.length,
          totalVideoSize: videoFiles.reduce((sum, f) => sum + f.fileSize, 0),
          averageVideoSize: videoFiles.reduce((sum, f) => sum + f.fileSize, 0) / videoFiles.length,
          resolutions: getVideoResolutionStats(videoFiles),
          codecs: getVideoCodecStats(videoFiles),
          durations: getVideoDurationStats(videoFiles),
          withAudio: videoFiles.filter((f) => f.videoMetadata?.hasAudio).length,
          compressionRatio: calculateCompressionRatio(videoFiles),
          uniqueSessions: [...new Set(videoFiles.map(f => f.sessionId).filter(Boolean))].length
        };
      }

      // Group by case
      filteredFiles.forEach((file) => {
        stats.byCaseId[file.caseId] = (stats.byCaseId[file.caseId] || 0) + 1;
      });

      // Group by user
      filteredFiles.forEach((file) => {
        stats.byUser[file.uploadedBy] = (stats.byUser[file.uploadedBy] || 0) + 1;
      });

      // Add detailed stats if requested
      if (detailed) {
        stats.detailed = {
          averageFileSize: stats.totalFiles > 0 ? stats.totalSize / stats.totalFiles : 0,
          largestFile: filteredFiles.reduce((max, f) => f.fileSize > max.fileSize ? f : max, { fileSize: 0 }),
          storageClasses: {},
          uploadMethods: {},
          topSourceUrls: getTopSourceUrls(filteredFiles, 10),
          sessionAnalysis: getSessionAnalysis(filteredFiles),
          peakUploadTimes: getPeakUploadTimes(filteredFiles),
          fileTypeDistribution: getFileTypeDistribution(filteredFiles)
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

  // ✅ NEW: Get video-specific statistics
  getVideoStats: async (req, res, next) => {
    try {
      const { 
        caseId, 
        days = 30, 
        groupBy = 'day',
        metrics = ['duration', 'size', 'count']
      } = req.query;

      let videoFiles = files.filter((f) => 
        f.status === "completed" && f.captureType === "video"
      );

      if (caseId) {
        videoFiles = videoFiles.filter((f) => f.caseId === caseId);
      }

      // Date filter
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
      videoFiles = videoFiles.filter(
        (f) => new Date(f.uploadedAt || f.createdAt) >= cutoffDate
      );

      const stats = {
        totalVideos: videoFiles.length,
        totalDuration: videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0),
        totalSize: videoFiles.reduce((sum, f) => sum + f.fileSize, 0),
        averageDuration: videoFiles.length > 0 ? 
          videoFiles.reduce((sum, f) => sum + (f.videoMetadata?.duration || 0), 0) / videoFiles.length : 0,
        averageSize: videoFiles.length > 0 ? 
          videoFiles.reduce((sum, f) => sum + f.fileSize, 0) / videoFiles.length : 0,
        resolutionBreakdown: getVideoResolutionStats(videoFiles),
        codecBreakdown: getVideoCodecStats(videoFiles),
        durationBreakdown: getVideoDurationStats(videoFiles),
        qualityMetrics: getVideoQualityMetrics(videoFiles),
        timeSeriesData: getVideoTimeSeriesData(videoFiles, groupBy, metrics),
        compressionAnalysis: {
          averageCompressionRatio: calculateCompressionRatio(videoFiles),
          estimatedRawSize: estimateRawVideoSize(videoFiles),
          compressionSavings: calculateCompressionSavings(videoFiles)
        },
        performanceMetrics: {
          averageUploadSpeed: calculateAverageUploadSpeed(videoFiles),
          multipartUploads: videoFiles.filter(f => f.uploadMethod === 'MULTIPART').length,
          failedUploads: files.filter(f => f.captureType === 'video' && f.status === 'failed').length
        }
      };

      res.json(stats);
    } catch (error) {
      console.error('Error getting video stats:', error);
      next(error);
    }
  },

  // ✅ NEW: Generate video thumbnail
  generateVideoThumbnail: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { timestamp = 0, width = 320, height = 240, format = 'jpg' } = req.body;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // Generate thumbnail key
      const thumbnailKey = `${fileKey.replace(/\.[^/.]+$/, "")}_thumb_${timestamp}s_${width}x${height}.${format}`;

      // TODO: Implement actual thumbnail generation (would use AWS MediaConvert or Lambda)
      const result = await s3Utils.generateVideoThumbnail(fileKey, thumbnailKey);

      res.json({
        success: true,
        thumbnailKey,
        thumbnailUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${thumbnailKey}`,
        originalFile: fileKey,
        timestamp,
        dimensions: { width, height },
        format,
        status: result.status,
        message: result.message
      });
    } catch (error) {
      console.error('Error generating video thumbnail:', error);
      next(error);
    }
  },

  // ✅ NEW: Request video compression
  compressVideo: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { quality = 'medium', targetSize, codec = 'h264', removeAudio = false } = req.body;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // Check permissions
      if (file.uploadedBy !== req.user.username && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Insufficient permissions",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Generate compressed file key
      const compressedKey = `${fileKey.replace(/\.[^/.]+$/, "")}_compressed_${quality}_${codec}.mp4`;
      const jobId = uuidv4();

      // TODO: Implement actual video compression (would use AWS MediaConvert)
      console.log(`Video compression requested: ${fileKey} -> ${compressedKey}`);
      console.log(`Quality: ${quality}, Codec: ${codec}, Remove audio: ${removeAudio}`);

      res.json({
        success: true,
        jobId,
        originalFile: fileKey,
        compressedFile: compressedKey,
        status: 'queued',
        compressionSettings: {
          quality,
          targetSize,
          codec,
          removeAudio
        },
        estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes estimate
        message: "Video compression job queued"
      });
    } catch (error) {
      console.error('Error starting video compression:', error);
      next(error);
    }
  },

  // ✅ NEW: Get video processing status
  getVideoProcessingStatus: async (req, res, next) => {
    try {
      const { fileKey, jobId } = req.params;

      // TODO: Implement actual status checking (would query AWS MediaConvert)
      const mockStatus = {
        jobId,
        fileKey,
        status: 'completed', // 'queued', 'processing', 'completed', 'failed'
        progress: 100,
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
        outputFiles: [
          {
            type: 'compressed_video',
            key: `${fileKey.replace(/\.[^/.]+$/, "")}_compressed_medium_h264.mp4`,
            size: 15728640,
            url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey.replace(/\.[^/.]+$/, "")}_compressed_medium_h264.mp4`
          }
        ],
        originalSize: 52428800,
        compressedSize: 15728640,
        compressionRatio: 0.3
      };

      res.json(mockStatus);
    } catch (error) {
      console.error('Error getting video processing status:', error);
      next(error);
    }
  },

  // ✅ NEW: Batch generate thumbnails
  batchGenerateThumbnails: async (req, res, next) => {
    try {
      const { fileKeys, thumbnailConfig = {} } = req.body;

      const results = [];
      const errors = [];

      for (const fileKey of fileKeys) {
        try {
          const file = files.find((f) => f.fileKey === fileKey);
          if (!file || file.captureType !== 'video') {
            errors.push({ fileKey, error: "File not found or not a video" });
            continue;
          }

          // Generate thumbnail (mock implementation)
          const thumbnailKey = `${fileKey.replace(/\.[^/.]+$/, "")}_thumb.jpg`;
          results.push({
            fileKey,
            thumbnailKey,
            status: 'queued'
          });
        } catch (error) {
          errors.push({ fileKey, error: error.message });
        }
      }

      res.json({
        success: true,
        processed: results.length,
        total: fileKeys.length,
        results,
        errors,
        message: `Batch thumbnail generation initiated for ${results.length} videos`
      });
    } catch (error) {
      console.error('Error batch generating thumbnails:', error);
      next(error);
    }
  },

  // ✅ NEW: Batch compress videos
  batchCompressVideos: async (req, res, next) => {
    try {
      const { fileKeys, compressionConfig = {} } = req.body;

      const results = [];
      const errors = [];

      for (const fileKey of fileKeys) {
        try {
          const file = files.find((f) => f.fileKey === fileKey);
          if (!file || file.captureType !== 'video') {
            errors.push({ fileKey, error: "File not found or not a video" });
            continue;
          }

          // Start compression job (mock implementation)
          const jobId = uuidv4();
          results.push({
            fileKey,
            jobId,
            status: 'queued',
            compressionConfig
          });
        } catch (error) {
          errors.push({ fileKey, error: error.message });
        }
      }

      res.json({
        success: true,
        processed: results.length,
        total: fileKeys.length,
        results,
        errors,
        estimatedCompletion: new Date(Date.now() + results.length * 5 * 60 * 1000).toISOString(),
        message: `Batch compression initiated for ${results.length} videos`
      });
    } catch (error) {
      console.error('Error batch compressing videos:', error);
      next(error);
    }
  },

  // ✅ NEW: Analyze video content
  analyzeVideo: async (req, res, next) => {
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

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // TODO: Implement actual video analysis (would use AWS Rekognition Video)
      const mockAnalysis = {
        fileKey,
        duration: file.videoMetadata?.duration || 120,
        resolution: {
          width: file.videoMetadata?.width || 1920,
          height: file.videoMetadata?.height || 1080
        },
        codec: file.videoMetadata?.codec || 'h264',
        bitrate: file.videoMetadata?.bitrate || 2000000,
        frameRate: file.videoMetadata?.fps || 30,
        hasAudio: file.videoMetadata?.hasAudio || false,
        fileSize: file.fileSize,
        quality: 'high',
        scenes: [
          { timestamp: 0, description: 'Browser window with login page', confidence: 0.95 },
          { timestamp: 30, description: 'User typing in form fields', confidence: 0.89 },
          { timestamp: 60, description: 'Navigation to dashboard', confidence: 0.92 }
        ],
        objects: [
          { name: 'browser_window', confidence: 0.98, frequency: 0.95 },
          { name: 'text_input', confidence: 0.87, frequency: 0.23 },
          { name: 'button', confidence: 0.93, frequency: 0.45 }
        ],
        text: [
          { timestamp: 5, text: 'Login', confidence: 0.99 },
          { timestamp: 15, text: 'Username', confidence: 0.95 },
          { timestamp: 25, text: 'Password', confidence: 0.94 }
        ]
      };

      res.json({
        success: true,
        analysis: mockAnalysis,
        analyzedAt: new Date().toISOString(),
        message: "Video analysis completed"
      });
    } catch (error) {
      console.error('Error analyzing video:', error);
      next(error);
    }
  },

  // ✅ NEW: Get video quality metrics
  getVideoQuality: async (req, res, next) => {
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

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // TODO: Implement actual quality analysis
      const qualityMetrics = {
        fileKey,
        overallScore: 8.5, // out of 10
        resolution: {
          width: file.videoMetadata?.width || 1920,
          height: file.videoMetadata?.height || 1080,
          score: 9.0
        },
        bitrate: {
          value: file.videoMetadata?.bitrate || 2000000,
          score: 8.0,
          recommendation: 'Good for screen recording'
        },
        frameRate: {
          value: file.videoMetadata?.fps || 30,
          score: 9.0,
          recommendation: 'Optimal for UI interactions'
        },
        compression: {
          ratio: 0.15,
          efficiency: 'good',
          score: 8.0
        },
        audio: {
          present: file.videoMetadata?.hasAudio || false,
          quality: file.videoMetadata?.hasAudio ? 'good' : null,
          score: file.videoMetadata?.hasAudio ? 7.5 : null
        },
        fileSize: {
          bytes: file.fileSize,
          sizePerSecond: file.fileSize / (file.videoMetadata?.duration || 1),
          efficiency: 'good'
        },
        recommendations: [
          'Video quality is suitable for documentation purposes',
          'Consider reducing bitrate for smaller file size',
          'Frame rate is optimal for screen captures'
        ]
      };

      res.json(qualityMetrics);
    } catch (error) {
      console.error('Error getting video quality:', error);
      next(error);
    }
  },

  // ✅ NEW: Get video streaming URL
  getVideoStreamUrl: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { quality = 'original', format = 'mp4' } = req.query;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // Generate streaming URL
      let streamingKey = fileKey;
      
      // TODO: Handle different quality levels and formats
      if (quality !== 'original' || format !== 'original') {
        streamingKey = `${fileKey.replace(/\.[^/.]+$/, "")}_${quality}.${format}`;
      }

      const streamingUrl = await s3Utils.generateDownloadUrl(streamingKey, 7200);

      res.json({
        streamingUrl,
        originalFile: fileKey,
        quality,
        format,
        duration: file.videoMetadata?.duration,
        resolution: {
          width: file.videoMetadata?.width,
          height: file.videoMetadata?.height
        },
        expiresIn: 7200,
        expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
        supportsRangeRequests: true
      });
    } catch (error) {
      console.error('Error getting video stream URL:', error);
      next(error);
    }
  },

  // ✅ NEW: Get video segments for adaptive streaming
  getVideoSegment: async (req, res, next) => {
    try {
      const { fileKey } = req.params;
      const { segment, quality = '720p' } = req.query;

      // Find file metadata
      const file = files.find((f) => f.fileKey === fileKey);
      if (!file) {
        return res.status(404).json({
          error: "File not found",
          code: "FILE_NOT_FOUND",
        });
      }

      if (file.captureType !== 'video') {
        return res.status(400).json({
          error: "File is not a video",
          code: "NOT_A_VIDEO",
        });
      }

      // TODO: Implement actual segment generation
      const segmentKey = `${fileKey.replace(/\.[^/.]+$/, "")}_${quality}_segment_${segment}.ts`;
      const segmentUrl = await s3Utils.generateDownloadUrl(segmentKey, 3600);

      res.json({
        segmentUrl,
        segmentNumber: parseInt(segment),
        quality,
        duration: 10, // 10 second segments
        expiresIn: 3600,
        nextSegment: parseInt(segment) + 1
      });
    } catch (error) {
      console.error('Error getting video segment:', error);
      next(error);
    }
  },

  // ✅ EXISTING METHODS - Enhanced with video support

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

      // Enhanced response with video metadata
      const response = {
        ...file,
        s3Metadata,
        storageStats: s3Utils.calculateStorageCosts(file.fileSize, s3Metadata.storageClass, file.captureType === 'video'),
      };

      // Add video-specific details
      if (file.captureType === 'video') {
        response.videoAnalysis = {
          estimatedBandwidth: calculateVideoBandwidth(file),
          storageOptimization: getVideoStorageRecommendations(file),
          streamingCompatibility: getStreamingCompatibility(file)
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Error getting file details:', error);
      next(error);
    }
  },

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

          // Abort multipart upload if still in progress
          if (file.multipartUploadId) {
            try {
              await s3Utils.abortMultipartUpload(file.fileKey, file.multipartUploadId);
            } catch (error) {
              console.warn(`Failed to abort multipart upload: ${error.message}`);
            }
          }

          // Delete from S3
          await s3Utils.deleteFile(fileKey);
          
          // Remove from metadata
          files.splice(fileIndex, 1);
          deletedFiles.push({
            fileKey: file.fileKey,
            fileName: file.fileName,
            description: file.description,
            sourceUrl: file.sourceUrl,
            captureType: file.captureType,
            fileSize: file.fileSize,
            duration: file.videoMetadata?.duration || null
          });

          // Update case metadata
          await updateCaseMetadata(
            caseId || file.caseId, 
            file.captureType, 
            -file.fileSize
          );

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
          totalSizeDeleted: deletedFiles.reduce((sum, f) => sum + f.fileSize, 0),
          videosDeleted: deletedFiles.filter(f => f.captureType === 'video').length
        },
      });
    } catch (error) {
      console.error('Error bulk deleting files:', error);
      next(error);
    }
  },

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
          'X-Video-Duration': metadata.metadata?.['video-duration'] || '',
          'X-Video-Resolution': metadata.metadata?.['video-width'] && metadata.metadata?.['video-height'] ? 
            `${metadata.metadata['video-width']}x${metadata.metadata['video-height']}` : '',
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

  getStorageCosts: async (req, res, next) => {
    try {
      const { caseId, storageClass = 'STANDARD', includeVideoOptimization = true } = req.query;

      let filteredFiles = files.filter((f) => f.status === "completed");

      if (caseId) {
        filteredFiles = filteredFiles.filter((f) => f.caseId === caseId);
      }

      const totalSize = filteredFiles.reduce((sum, f) => sum + f.fileSize, 0);
      const videoFiles = filteredFiles.filter(f => f.captureType === 'video');
      const screenshotFiles = filteredFiles.filter(f => f.captureType === 'screenshot');

      const costs = s3Utils.calculateStorageCosts(totalSize, storageClass);

      const response = {
        totalFiles: filteredFiles.length,
        totalSize,
        costs,
        breakdown: {
          perFile: costs.monthly / filteredFiles.length || 0,
          perGB: costs.monthly / costs.sizeGB || 0,
          videos: {
            count: videoFiles.length,
            size: videoFiles.reduce((sum, f) => sum + f.fileSize, 0),
            monthlyCost: s3Utils.calculateStorageCosts(
              videoFiles.reduce((sum, f) => sum + f.fileSize, 0), 
              storageClass, 
              true
            ).monthly
          },
          screenshots: {
            count: screenshotFiles.length,
            size: screenshotFiles.reduce((sum, f) => sum + f.fileSize, 0),
            monthlyCost: s3Utils.calculateStorageCosts(
              screenshotFiles.reduce((sum, f) => sum + f.fileSize, 0), 
              storageClass
            ).monthly
          }
        },
        recommendations: generateStorageRecommendations(totalSize, filteredFiles)
      };

      // Add video optimization recommendations
      if (includeVideoOptimization && videoFiles.length > 0) {
        response.videoOptimization = {
          compressionPotential: calculateCompressionPotential(videoFiles),
          archivalCandidates: getArchivalCandidates(videoFiles),
          estimatedSavings: calculateOptimizationSavings(videoFiles)
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Error getting storage costs:', error);
      next(error);
    }
  },

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

      const file = files[fileIndex];

      // Validate storage class for video files
      if (file.captureType === 'video' && storageClass === 'DEEP_ARCHIVE') {
        console.warn('DEEP_ARCHIVE not recommended for video files due to long retrieval times');
      }

      // Note: In a real implementation, you would use S3's CopyObject API
      // to change storage class. For this mock, we'll just update metadata.
      files[fileIndex].s3Metadata = {
        ...files[fileIndex].s3Metadata,
        storageClass,
      };

      const newCosts = s3Utils.calculateStorageCosts(
        file.fileSize, 
        storageClass, 
        file.captureType === 'video'
      );

      res.json({
        success: true,
        message: `Storage class changed to ${storageClass}`,
        file: files[fileIndex],
        costImpact: {
          newMonthlyCost: newCosts.monthly,
          previousCost: s3Utils.calculateStorageCosts(
            file.fileSize, 
            file.s3Metadata?.storageClass || 'STANDARD', 
            file.captureType === 'video'
          ).monthly,
          savings: s3Utils.calculateStorageCosts(
            file.fileSize, 
            file.s3Metadata?.storageClass || 'STANDARD', 
            file.captureType === 'video'
          ).monthly - newCosts.monthly
        }
      });
    } catch (error) {
      console.error('Error changing storage class:', error);
      next(error);
    }
  },
};

// ✅ HELPER FUNCTIONS

// Update case metadata helper
async function updateCaseMetadata(caseId, captureType, fileSizeDelta) {
  const caseIndex = cases.findIndex((c) => c.id === caseId);
  if (caseIndex !== -1) {
    const case_ = cases[caseIndex];
    const isScreenshot = captureType === "screenshot";
    const isVideo = captureType === "video";

    cases[caseIndex] = {
      ...case_,
      metadata: {
        ...case_.metadata,
        totalScreenshots: isScreenshot
          ? Math.max(0, (case_.metadata.totalScreenshots || 0) + (fileSizeDelta > 0 ? 1 : -1))
          : case_.metadata.totalScreenshots || 0,
        totalVideos: isVideo
          ? Math.max(0, (case_.metadata.totalVideos || 0) + (fileSizeDelta > 0 ? 1 : -1))
          : case_.metadata.totalVideos || 0,
        totalFileSize: Math.max(
          0,
          (case_.metadata.totalFileSize || 0) + fileSizeDelta
        ),
        lastActivity: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

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

// Helper function to calculate relevance score for search
function getRelevanceScore(file, searchQuery) {
  let score = 0;
  const query = searchQuery.toLowerCase();

  // Higher score for matches in filename
  if (file.fileName && file.fileName.toLowerCase().includes(query)) {
    score += 10;
  }

  // Medium score for matches in description
  if (file.description && file.description.toLowerCase().includes(query)) {
    score += 7;
  }

  // Lower score for matches in source URL
  if (file.sourceUrl && file.sourceUrl.toLowerCase().includes(query)) {
    score += 5;
  }

  // Video-specific search bonuses
  if (file.captureType === 'video') {
    if (file.videoMetadata?.codec && file.videoMetadata.codec.toLowerCase().includes(query)) {
      score += 6;
    }
  }

  // Bonus for exact matches
  if (file.fileName && file.fileName.toLowerCase() === query) {
    score += 20;
  }

  return score;
}

// Helper function to get top source URLs
function getTopSourceUrls(files, limit = 10) {
  const urlCounts = {};

  files.forEach((file) => {
    if (file.sourceUrl) {
      try {
        const url = new URL(file.sourceUrl);
        const domain = url.hostname;
        urlCounts[domain] = (urlCounts[domain] || 0) + 1;
      } catch (error) {
        // Invalid URL, skip
      }
    }
  });

  return Object.entries(urlCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

// ✅ VIDEO-SPECIFIC HELPER FUNCTIONS

function getVideoResolutionStats(videoFiles) {
  const resolutions = {};
  
  videoFiles.forEach(file => {
    if (file.videoMetadata?.width && file.videoMetadata?.height) {
      const resolution = `${file.videoMetadata.width}x${file.videoMetadata.height}`;
      resolutions[resolution] = (resolutions[resolution] || 0) + 1;
    }
  });

  return resolutions;
}

function getVideoCodecStats(videoFiles) {
  const codecs = {};
  
  videoFiles.forEach(file => {
    const codec = file.videoMetadata?.codec || 'unknown';
    codecs[codec] = (codecs[codec] || 0) + 1;
  });

  return codecs;
}

function getVideoDurationStats(videoFiles) {
  const durations = videoFiles.map(f => f.videoMetadata?.duration || 0).filter(d => d > 0);
  
  if (durations.length === 0) return {};

  durations.sort((a, b) => a - b);

  return {
    min: durations[0],
    max: durations[durations.length - 1],
    average: durations.reduce((sum, d) => sum + d, 0) / durations.length,
    median: durations[Math.floor(durations.length / 2)],
    ranges: {
      '0-30s': durations.filter(d => d <= 30).length,
      '30s-2m': durations.filter(d => d > 30 && d <= 120).length,
      '2m-5m': durations.filter(d => d > 120 && d <= 300).length,
      '5m+': durations.filter(d => d > 300).length
    }
  };
}

function calculateCompressionRatio(videoFiles) {
  // Estimate compression ratio based on file size vs estimated raw size
  const totalCompressedSize = videoFiles.reduce((sum, f) => sum + f.fileSize, 0);
  const estimatedRawSize = videoFiles.reduce((sum, f) => {
    const duration = f.videoMetadata?.duration || 0;
    const width = f.videoMetadata?.width || 1920;
    const height = f.videoMetadata?.height || 1080;
    const fps = f.videoMetadata?.fps || 30;
    // Rough calculation: width * height * 3 bytes * fps * duration
    return sum + (width * height * 3 * fps * duration);
  }, 0);

  return estimatedRawSize > 0 ? totalCompressedSize / estimatedRawSize : 0;
}

function getVideoQualityMetrics(videoFiles) {
  const bitrates = videoFiles
    .map(f => f.videoMetadata?.bitrate)
    .filter(b => b && b > 0);

  if (bitrates.length === 0) return {};

  return {
    averageBitrate: bitrates.reduce((sum, b) => sum + b, 0) / bitrates.length,
    bitrateRange: {
      min: Math.min(...bitrates),
      max: Math.max(...bitrates)
    },
    qualityDistribution: {
      low: bitrates.filter(b => b < 1000000).length,      // < 1 Mbps
      medium: bitrates.filter(b => b >= 1000000 && b < 5000000).length, // 1-5 Mbps
      high: bitrates.filter(b => b >= 5000000).length     // >= 5 Mbps
    }
  };
}

function getVideoTimeSeriesData(videoFiles, groupBy, metrics) {
  // Group files by time period
  const groups = {};
  
  videoFiles.forEach(file => {
    const date = new Date(file.uploadedAt || file.createdAt);
    let key;
    
    switch (groupBy) {
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
        break;
      case 'month':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'day':
      default:
        key = date.toISOString().split('T')[0];
        break;
    }
    
    if (!groups[key]) {
      groups[key] = { count: 0, duration: 0, size: 0 };
    }
    
    groups[key].count++;
    groups[key].duration += file.videoMetadata?.duration || 0;
    groups[key].size += file.fileSize;
  });

  // Convert to time series format
  const timeSeries = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      ...data
    }));

  return timeSeries;
}

function getSessionAnalysis(files) {
  const sessions = {};
  
  files.forEach(file => {
    if (file.sessionId) {
      if (!sessions[file.sessionId]) {
        sessions[file.sessionId] = {
          fileCount: 0,
          totalSize: 0,
          totalDuration: 0,
          captureTypes: {},
          startTime: null,
          endTime: null
        };
      }
      
      const session = sessions[file.sessionId];
      session.fileCount++;
      session.totalSize += file.fileSize;
      session.totalDuration += file.videoMetadata?.duration || 0;
      session.captureTypes[file.captureType] = (session.captureTypes[file.captureType] || 0) + 1;
      
      const fileTime = new Date(file.uploadedAt || file.createdAt);
      if (!session.startTime || fileTime < new Date(session.startTime)) {
        session.startTime = fileTime.toISOString();
      }
      if (!session.endTime || fileTime > new Date(session.endTime)) {
        session.endTime = fileTime.toISOString();
      }
    }
  });

  return {
    totalSessions: Object.keys(sessions).length,
    averageFilesPerSession: Object.keys(sessions).length > 0 ? 
      Object.values(sessions).reduce((sum, s) => sum + s.fileCount, 0) / Object.keys(sessions).length : 0,
    sessions: Object.entries(sessions).slice(0, 10).map(([id, data]) => ({ id, ...data }))
  };
}

function getPeakUploadTimes(files) {
  const hourCounts = new Array(24).fill(0);
  const dayOfWeekCounts = new Array(7).fill(0);
  
  files.forEach(file => {
    const date = new Date(file.uploadedAt || file.createdAt);
    hourCounts[date.getHours()]++;
    dayOfWeekCounts[date.getDay()]++;
  });
  
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakDay = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  return {
    peakHour: `${peakHour}:00`,
    peakDay: dayNames[peakDay],
    hourlyDistribution: hourCounts,
    dailyDistribution: dayOfWeekCounts
  };
}

function getFileTypeDistribution(files) {
  const types = {};
  
  files.forEach(file => {
    const extension = file.fileName.split('.').pop()?.toLowerCase() || 'unknown';
    types[extension] = (types[extension] || 0) + 1;
  });
  
  return types;
}

function calculateVideoBandwidth(file) {
  if (file.captureType !== 'video' || !file.videoMetadata?.duration) {
    return null;
  }
  
  return {
    bitsPerSecond: (file.fileSize * 8) / file.videoMetadata.duration,
    mbitsPerSecond: ((file.fileSize * 8) / file.videoMetadata.duration) / 1000000,
    recommendation: getBandwidthRecommendation((file.fileSize * 8) / file.videoMetadata.duration)
  };
}

function getBandwidthRecommendation(bps) {
  if (bps < 500000) return 'Low quality - suitable for basic documentation';
  if (bps < 2000000) return 'Medium quality - good for most screen recordings';
  if (bps < 8000000) return 'High quality - excellent for detailed capture';
  return 'Very high quality - may be unnecessarily large';
}

function getVideoStorageRecommendations(file) {
  const recommendations = [];
  
  if (file.fileSize > 50 * 1024 * 1024) { // > 50MB
    recommendations.push('Consider Standard-IA storage class for cost savings');
  }
  
  if (file.videoMetadata?.duration > 600) { // > 10 minutes
    recommendations.push('Long video - consider compression or segmentation');
  }
  
  const daysSinceUpload = (Date.now() - new Date(file.uploadedAt || file.createdAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceUpload > 30) {
    recommendations.push('Old video - candidate for archival storage');
  }
  
  return recommendations;
}

function getStreamingCompatibility(file) {
  if (file.captureType !== 'video') return null;
  
  const codec = file.videoMetadata?.codec?.toLowerCase();
  const format = file.fileType?.split('/')[1];
  
  return {
    webCompatible: ['h264', 'vp8', 'vp9'].includes(codec) && ['mp4', 'webm'].includes(format),
    mobileCompatible: codec === 'h264' && format === 'mp4',
    browserSupport: {
      chrome: ['h264', 'vp8', 'vp9', 'av1'].includes(codec),
      firefox: ['h264', 'vp8', 'vp9', 'av1'].includes(codec),
      safari: ['h264'].includes(codec)
    },
    recommendation: getStreamingRecommendation(codec, format)
  };
}

function getStreamingRecommendation(codec, format) {
  if (codec === 'h264' && format === 'mp4') {
    return 'Optimal for streaming - universally supported';
  }
  if (codec === 'vp9' && format === 'webm') {
    return 'Good for web streaming - modern browser support';
  }
  return 'May need transcoding for optimal streaming compatibility';
}

function calculateCompressionPotential(videoFiles) {
  return videoFiles.map(file => {
    const currentBitrate = file.videoMetadata?.bitrate || 0;
    const duration = file.videoMetadata?.duration || 0;
    
    if (currentBitrate === 0 || duration === 0) return null;
    
    const targetBitrate = 1000000; // 1 Mbps target
    const potentialReduction = currentBitrate > targetBitrate ? 
      1 - (targetBitrate / currentBitrate) : 0;
    
    return {
      fileKey: file.fileKey,
      currentSize: file.fileSize,
      currentBitrate,
      potentialReduction,
      estimatedNewSize: file.fileSize * (1 - potentialReduction),
      spaceSavings: file.fileSize * potentialReduction
    };
  }).filter(Boolean);
}

function getArchivalCandidates(videoFiles) {
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  return videoFiles
    .filter(file => new Date(file.uploadedAt || file.createdAt) < thirtyDaysAgo)
    .map(file => ({
      fileKey: file.fileKey,
      size: file.fileSize,
      uploadedAt: file.uploadedAt || file.createdAt,
      currentStorageClass: file.s3Metadata?.storageClass || 'STANDARD',
      recommendedClass: file.fileSize > 100 * 1024 * 1024 ? 'GLACIER' : 'STANDARD_IA',
      monthlySavings: s3Utils.calculateStorageCosts(file.fileSize, 'STANDARD').monthly - 
                     s3Utils.calculateStorageCosts(file.fileSize, 'GLACIER').monthly
    }));
}

function calculateOptimizationSavings(videoFiles) {
  const compressionSavings = calculateCompressionPotential(videoFiles)
    .reduce((sum, item) => sum + item.spaceSavings, 0);
  
  const archivalSavings = getArchivalCandidates(videoFiles)
    .reduce((sum, item) => sum + item.monthlySavings * 12, 0); // Annual savings
  
  return {
    compressionSavings: {
      totalSpaceReduction: compressionSavings,
      monthlyCostSavings: s3Utils.calculateStorageCosts(compressionSavings).monthly
    },
    archivalSavings: {
      annualCostSavings: archivalSavings
    },
    totalPotentialSavings: s3Utils.calculateStorageCosts(compressionSavings).monthly * 12 + archivalSavings
  };
}

function calculateAverageUploadSpeed(videoFiles) {
  // Estimate upload speed based on file size and upload duration
  // This is a rough calculation as we don't track actual upload start/end times
  const speeds = videoFiles
    .filter(f => f.uploadedAt && f.createdAt)
    .map(f => {
      const uploadDuration = (new Date(f.uploadedAt) - new Date(f.createdAt)) / 1000; // seconds
      return uploadDuration > 0 ? f.fileSize / uploadDuration : 0; // bytes per second
    })
    .filter(speed => speed > 0);
  
  if (speeds.length === 0) return null;
  
  const avgSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  
  return {
    averageSpeedBps: avgSpeed,
    averageSpeedMbps: avgSpeed / (1024 * 1024), // MB/s
    recommendation: avgSpeed < 1024 * 1024 ? 'Consider multipart uploads for better performance' : 'Upload speed is good'
  };
}

function estimateRawVideoSize(videoFiles) {
  return videoFiles.reduce((sum, f) => {
    const duration = f.videoMetadata?.duration || 0;
    const width = f.videoMetadata?.width || 1920;
    const height = f.videoMetadata?.height || 1080;
    const fps = f.videoMetadata?.fps || 30;
    // Rough calculation: width * height * 3 bytes * fps * duration
    return sum + (width * height * 3 * fps * duration);
  }, 0);
}

function calculateCompressionSavings(videoFiles) {
  const totalCompressedSize = videoFiles.reduce((sum, f) => sum + f.fileSize, 0);
  const estimatedRawSize = estimateRawVideoSize(videoFiles);
  const savings = estimatedRawSize - totalCompressedSize;
  
  return {
    rawSize: estimatedRawSize,
    compressedSize: totalCompressedSize,
    spaceSaved: savings,
    compressionRatio: estimatedRawSize > 0 ? totalCompressedSize / estimatedRawSize : 0,
    monthlyCostSavings: s3Utils.calculateStorageCosts(savings).monthly
  };
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

  const largeVideos = files.filter(f => 
    f.captureType === 'video' && f.fileSize > 100 * 1024 * 1024
  );

  if (largeVideos.length > 0) {
    recommendations.push({
      type: 'compression',
      message: `${largeVideos.length} large video files could benefit from compression`,
      potentialSavings: 'Up to 60% size reduction with minimal quality loss'
    });
  }

  return recommendations;
}

module.exports = uploadController;