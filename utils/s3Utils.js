// utils/s3Utils.js - Enhanced for Video Recording Support
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { v4: uuidv4 } = require("uuid");

// ✅ ENHANCED: Video-specific configurations
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  signatureVersion: "v4",
  useAccelerateEndpoint: false,
  forcePathStyle: false,
  maxAttempts: 3,
  retryMode: "adaptive",
  requestTimeout: 300000, // ✅ Increased to 5 minutes for large video files
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024; // ✅ Increased to 500MB for videos
const VIDEO_MAX_SIZE =
  parseInt(process.env.VIDEO_MAX_SIZE) || 1024 * 1024 * 1024; // ✅ 1GB for video files
const MULTIPART_THRESHOLD =
  parseInt(process.env.MULTIPART_THRESHOLD) || 100 * 1024 * 1024; // ✅ 100MB threshold for multipart

// ✅ ENHANCED: Extended video format support
const ALLOWED_FILE_TYPES = [
  // Images
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",

  // Videos - Enhanced support
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo", // .avi
  "video/x-ms-wmv", // .wmv
  "video/3gpp", // .3gp
  "video/x-flv", // .flv
  "video/ogg", // .ogv
  "video/x-matroska", // .mkv
];

// ✅ NEW: Video codec and quality validation
const VIDEO_CODECS = {
  webm: ["vp8", "vp9", "av1"],
  mp4: ["h264", "h265", "av1"],
  mov: ["h264", "h265"],
  avi: ["h264", "xvid", "divx"],
};

const s3Utils = {
  // ✅ ENHANCED: Generate S3 key with video-specific organization
  generateS3Key: (caseId, captureType, fileName, userId, sessionId = null) => {
    const timestamp = new Date().toISOString().split("T")[0];
    const uniqueId = uuidv4().split("-")[0];
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileExtension = fileName.split(".").pop()?.toLowerCase();

    // ✅ Enhanced path structure for videos
    if (captureType === "video") {
      const sessionFolder = sessionId
        ? `session-${sessionId}`
        : `session-${Date.now()}`;
      return `cases/${caseId}/videos/${timestamp}/${sessionFolder}/${uniqueId}_${Date.now()}.${fileExtension}`;
    }

    return `cases/${caseId}/${captureType}/${timestamp}/${uniqueId}_${Date.now()}.${fileExtension}`;
  },

  // ✅ ENHANCED: Video-aware validation with codec parameter support
  validateFileParams: (
    fileName,
    fileType,
    fileSize,
    captureType,
    videoMetadata = {}
  ) => {
    const errors = [];

    if (!fileName || fileName.trim().length === 0) {
      errors.push("File name is required");
    }

    if (!fileType) {
      errors.push("File type is required");
    } else {
      // Clean file type by removing codec parameters (e.g., "video/webm;codecs=vp9" -> "video/webm")
      const cleanFileType = fileType.split(";")[0].trim();

      if (!ALLOWED_FILE_TYPES.includes(cleanFileType)) {
        errors.push(
          `File type ${fileType} is not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(
            ", "
          )}`
        );
      }

      // Extract codec information from file type if present
      const codecMatch = fileType.match(/codecs=([^;,]+)/i);
      if (codecMatch && videoMetadata && captureType === "video") {
        const detectedCodec = codecMatch[1].replace(/"/g, "").toLowerCase();

        // Validate codec against file container
        const container = cleanFileType.split("/")[1];
        const supportedCodecs = VIDEO_CODECS[container] || [];

        if (
          supportedCodecs.length > 0 &&
          !supportedCodecs.includes(detectedCodec)
        ) {
          console.warn(
            `Codec ${detectedCodec} may not be optimal for ${container} container`
          );
          // Don't add as error, just warn
        }

        // Auto-populate codec in videoMetadata if not provided
        if (!videoMetadata.codec) {
          videoMetadata.codec = detectedCodec;
        }
      }
    }

    // ✅ Different size limits for videos vs images
    const maxSize = captureType === "video" ? VIDEO_MAX_SIZE : MAX_FILE_SIZE;
    if (fileSize && fileSize > maxSize) {
      const maxSizeMB = maxSize / (1024 * 1024);
      errors.push(`File size exceeds ${maxSizeMB}MB limit for ${captureType}`);
    }

    if (!captureType || !["screenshot", "video"].includes(captureType)) {
      errors.push('Capture type must be either "screenshot" or "video"');
    }

    // ✅ Video-specific validation
    if (captureType === "video") {
      const { duration, width, height, bitrate } = videoMetadata;

      // Duration check (max 30 minutes)
      if (duration && duration > 1800) {
        errors.push("Video duration cannot exceed 30 minutes");
      }

      // Resolution check (max 4K)
      if (width && height) {
        if (width > 3840 || height > 2160) {
          errors.push("Video resolution cannot exceed 4K (3840x2160)");
        }
      }

      // Bitrate check (max 50 Mbps)
      if (bitrate && bitrate > 50000000) {
        errors.push("Video bitrate cannot exceed 50 Mbps");
      }
    }

    // Validate file extension
    const allowedExtensions = {
      screenshot: ["png", "jpg", "jpeg", "webp", "gif"],
      video: ["webm", "mp4", "mov", "avi", "wmv", "3gp", "flv", "ogv", "mkv"],
    };

    const fileExtension = fileName.split(".").pop()?.toLowerCase();
    if (
      fileExtension &&
      !allowedExtensions[captureType].includes(fileExtension)
    ) {
      errors.push(
        `File extension .${fileExtension} not allowed for ${captureType}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      useMultipart: fileSize > MULTIPART_THRESHOLD,
      recommendedChunkSize: s3Utils.calculateOptimalChunkSize(fileSize),
      detectedCodec: videoMetadata.codec || null,
      cleanFileType: fileType.split(";")[0].trim(),
    };
  },
  // ✅ NEW: Calculate optimal chunk size for multipart uploads
  calculateOptimalChunkSize: (fileSize) => {
    if (fileSize < 100 * 1024 * 1024) return 10 * 1024 * 1024; // 10MB for small files
    if (fileSize < 500 * 1024 * 1024) return 20 * 1024 * 1024; // 20MB for medium files
    return 50 * 1024 * 1024; // 50MB for large files
  },

  // ✅ ENHANCED: Generate presigned URL with video optimization
  generatePresignedUrl: async (
    key,
    fileType,
    expiresIn = 3600,
    videoMetadata = {}
  ) => {
    try {
      console.log(
        `🔗 Generating presigned URL for ${key} with type ${fileType}`
      );

      // ✅ Enhanced metadata for videos
      const metadata = {
        "uploaded-by": "cellebrite-capture-tool",
        "upload-timestamp": new Date().toISOString(),
        "file-type": fileType,
      };

      // Add video-specific metadata
      if (fileType.startsWith("video/")) {
        if (videoMetadata.duration)
          metadata["video-duration"] = videoMetadata.duration.toString();
        if (videoMetadata.width)
          metadata["video-width"] = videoMetadata.width.toString();
        if (videoMetadata.height)
          metadata["video-height"] = videoMetadata.height.toString();
        if (videoMetadata.codec) metadata["video-codec"] = videoMetadata.codec;
        if (videoMetadata.bitrate)
          metadata["video-bitrate"] = videoMetadata.bitrate.toString();
      }

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: fileType,
        ServerSideEncryption: "AES256",
        Metadata: metadata,
        // ✅ Video-specific storage optimizations
        StorageClass: fileType.startsWith("video/") ? "STANDARD" : "STANDARD",
        ContentDisposition: fileType.startsWith("video/")
          ? "inline"
          : undefined,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: fileType.startsWith("video/") ? 7200 : expiresIn, // ✅ Longer expiry for videos
        signableHeaders: new Set(["content-type"]),
      });

      const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

      console.log(`✅ Presigned URL generated successfully for ${key}`);

      return {
        uploadUrl,
        fileUrl,
        method: "PUT",
        headers: {
          "Content-Type": fileType,
        },
        expiresIn: fileType.startsWith("video/") ? 7200 : expiresIn,
      };
    } catch (error) {
      console.error("❌ Error generating presigned URL:", error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  },

  // ✅ NEW: Initialize multipart upload for large videos
  initializeMultipartUpload: async (key, fileType, videoMetadata = {}) => {
    try {
      console.log(`🚀 Initializing multipart upload for ${key}`);

      const metadata = {
        "uploaded-by": "cellebrite-capture-tool",
        "upload-timestamp": new Date().toISOString(),
        "file-type": fileType,
        "upload-method": "multipart",
      };

      if (videoMetadata.duration)
        metadata["video-duration"] = videoMetadata.duration.toString();
      if (videoMetadata.width)
        metadata["video-width"] = videoMetadata.width.toString();
      if (videoMetadata.height)
        metadata["video-height"] = videoMetadata.height.toString();

      const command = new CreateMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: fileType,
        ServerSideEncryption: "AES256",
        Metadata: metadata,
        StorageClass: "STANDARD",
      });

      const result = await s3Client.send(command);
      console.log(`✅ Multipart upload initialized: ${result.UploadId}`);

      return {
        uploadId: result.UploadId,
        key: key,
        bucket: BUCKET_NAME,
      };
    } catch (error) {
      console.error("❌ Error initializing multipart upload:", error);
      throw new Error(
        `Failed to initialize multipart upload: ${error.message}`
      );
    }
  },

  // ✅ NEW: Generate presigned URL for multipart upload part
  generateMultipartPartUrl: async (
    key,
    uploadId,
    partNumber,
    expiresIn = 3600
  ) => {
    try {
      const command = new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

      return {
        uploadUrl,
        partNumber,
        uploadId,
      };
    } catch (error) {
      console.error(`❌ Error generating part ${partNumber} URL:`, error);
      throw new Error(`Failed to generate multipart URL: ${error.message}`);
    }
  },

  // ✅ NEW: Complete multipart upload
  completeMultipartUpload: async (key, uploadId, parts) => {
    try {
      console.log(`🏁 Completing multipart upload for ${key}`);

      const command = new CompleteMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
        },
      });

      const result = await s3Client.send(command);
      console.log(`✅ Multipart upload completed successfully`);

      return {
        location: result.Location,
        bucket: result.Bucket,
        key: result.Key,
        etag: result.ETag,
      };
    } catch (error) {
      console.error("❌ Error completing multipart upload:", error);
      throw new Error(`Failed to complete multipart upload: ${error.message}`);
    }
  },

  // ✅ NEW: Abort multipart upload
  abortMultipartUpload: async (key, uploadId) => {
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
      });

      await s3Client.send(command);
      console.log(`🚫 Multipart upload aborted for ${key}`);
      return true;
    } catch (error) {
      console.error("❌ Error aborting multipart upload:", error);
      throw new Error(`Failed to abort multipart upload: ${error.message}`);
    }
  },

  // ✅ ENHANCED: Video-optimized presigned POST
  generatePresignedPost: async (
    key,
    fileType,
    fileSize,
    expiresIn = 3600,
    videoMetadata = {}
  ) => {
    try {
      console.log(
        `🔗 Generating presigned POST for ${key} with type ${fileType}`
      );

      const maxSize = fileType.startsWith("video/")
        ? VIDEO_MAX_SIZE
        : MAX_FILE_SIZE;

      const conditions = [
        ["content-length-range", 1024, maxSize],
        ["eq", "$Content-Type", fileType],
        ["eq", "$key", key],
      ];

      const fields = {
        key: key,
        "Content-Type": fileType,
        "x-amz-server-side-encryption": "AES256",
      };

      // Add video metadata to fields
      if (fileType.startsWith("video/") && videoMetadata) {
        if (videoMetadata.duration) {
          fields["x-amz-meta-video-duration"] =
            videoMetadata.duration.toString();
        }
        if (videoMetadata.width && videoMetadata.height) {
          fields[
            "x-amz-meta-video-resolution"
          ] = `${videoMetadata.width}x${videoMetadata.height}`;
        }
      }

      const { url, fields: presignedFields } = await createPresignedPost(
        s3Client,
        {
          Bucket: BUCKET_NAME,
          Key: key,
          Conditions: conditions,
          Fields: fields,
          Expires: fileType.startsWith("video/") ? 7200 : expiresIn, // Longer expiry for videos
        }
      );

      const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

      console.log(`✅ Presigned POST generated successfully for ${key}`);

      return {
        uploadUrl: url,
        fileUrl,
        fields: presignedFields,
        method: "POST",
        maxFileSize: maxSize,
      };
    } catch (error) {
      console.error("❌ Error generating presigned POST:", error);
      throw new Error(`Failed to generate presigned POST: ${error.message}`);
    }
  },

  // ✅ ENHANCED: CORS setup optimized for video uploads
  setupCors: async () => {
    try {
      const corsConfiguration = {
        CORSRules: [
          {
            ID: "ScreenCaptureToolCORS",
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: ["*"],
            ExposeHeaders: [
              "ETag",
              "x-amz-meta-*",
              "x-amz-version-id",
              "x-amz-request-id",
              "x-amz-multipart-upload-id", // ✅ For multipart uploads
            ],
            MaxAgeSeconds: 3600,
          },
          // ✅ Specific rule for video uploads
          {
            ID: "VideoUploadCORS",
            AllowedHeaders: [
              "Content-Type",
              "Content-Length",
              "Authorization",
              "x-amz-date",
              "x-amz-content-sha256",
              "x-amz-meta-*",
            ],
            AllowedMethods: ["PUT", "POST"],
            AllowedOrigins: [
              "chrome-extension://*",
              "moz-extension://*",
              "http://localhost:*",
              "https://localhost:*",
            ],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 7200, // Longer cache for video uploads
          },
        ],
      };

      const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: corsConfiguration,
      });

      await s3Client.send(command);
      console.log("✅ Enhanced CORS configuration applied for video uploads");
      return true;
    } catch (error) {
      console.error("❌ Error setting up CORS:", error);
      throw new Error(`Failed to setup CORS: ${error.message}`);
    }
  },

  // ✅ NEW: Video processing utilities
  generateVideoThumbnail: async (videoKey, thumbnailKey) => {
    // This would integrate with AWS MediaConvert or Lambda for thumbnail generation
    // For now, return placeholder implementation
    console.log(
      `📸 Thumbnail generation requested for ${videoKey} -> ${thumbnailKey}`
    );
    return {
      thumbnailKey,
      status: "pending",
      message: "Thumbnail generation not implemented yet",
    };
  },

  // ✅ NEW: Get video metadata from S3
  getVideoMetadata: async (key) => {
    try {
      const metadata = await s3Utils.getFileMetadata(key);

      if (!metadata.contentType?.startsWith("video/")) {
        throw new Error("File is not a video");
      }

      const videoInfo = {
        duration: metadata.metadata?.["video-duration"]
          ? parseFloat(metadata.metadata["video-duration"])
          : null,
        width: metadata.metadata?.["video-width"]
          ? parseInt(metadata.metadata["video-width"])
          : null,
        height: metadata.metadata?.["video-height"]
          ? parseInt(metadata.metadata["video-height"])
          : null,
        codec: metadata.metadata?.["video-codec"] || null,
        bitrate: metadata.metadata?.["video-bitrate"]
          ? parseInt(metadata.metadata["video-bitrate"])
          : null,
        size: metadata.contentLength,
        format: metadata.contentType.split("/")[1],
      };

      return videoInfo;
    } catch (error) {
      console.error(`Error getting video metadata for ${key}:`, error);
      throw new Error(`Failed to get video metadata: ${error.message}`);
    }
  },

  // All existing methods remain the same...
  deleteFile: async (key) => {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);
      console.log(`File deleted successfully: ${key}`);
      return true;
    } catch (error) {
      console.error(`Error deleting file ${key}:`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  },

  fileExists: async (key) => {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);
      return true;
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  },

  getFileMetadata: async (key) => {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const result = await s3Client.send(command);

      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        etag: result.ETag?.replace(/"/g, ""),
        metadata: result.Metadata,
        serverSideEncryption: result.ServerSideEncryption,
        storageClass: result.StorageClass,
      };
    } catch (error) {
      console.error(`Error getting file metadata ${key}:`, error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  },

  generateDownloadUrl: async (key, expiresIn = 3600, filename = null) => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: key,
      };

      if (filename) {
        params.ResponseContentDisposition = `attachment; filename="${filename}"`;
      }

      const command = new GetObjectCommand(params);
      return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
      console.error(`Error generating download URL for ${key}:`, error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  },

  listCaseFiles: async (caseId, captureType = "", maxKeys = 1000) => {
    try {
      const prefix = captureType
        ? `cases/${caseId}/${captureType}/`
        : `cases/${caseId}/`;

      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });

      const result = await s3Client.send(command);

      return (result.Contents || []).map((obj) => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        etag: obj.ETag?.replace(/"/g, ""),
        storageClass: obj.StorageClass,
      }));
    } catch (error) {
      console.error(`Error listing files for case ${caseId}:`, error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  },

  getBucketInfo: async () => {
    try {
      const command = new HeadBucketCommand({
        Bucket: BUCKET_NAME,
      });

      const result = await s3Client.send(command);
      return {
        exists: true,
        name: BUCKET_NAME,
        region: process.env.AWS_REGION,
        bucketRegion: result.BucketRegion,
      };
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return { exists: false, name: BUCKET_NAME };
      }
      console.error("Error getting bucket info:", error);
      throw error;
    }
  },

  createBucket: async () => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
      };

      if (process.env.AWS_REGION !== "us-east-1") {
        params.CreateBucketConfiguration = {
          LocationConstraint: process.env.AWS_REGION,
        };
      }

      const command = new CreateBucketCommand(params);
      await s3Client.send(command);

      console.log(`Bucket ${BUCKET_NAME} created successfully`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return true;
    } catch (error) {
      if (
        error.name === "BucketAlreadyExists" ||
        error.name === "BucketAlreadyOwnedByYou"
      ) {
        console.log(`Bucket ${BUCKET_NAME} already exists`);
        return true;
      }
      console.error("Error creating bucket:", error);
      throw new Error(`Failed to create bucket: ${error.message}`);
    }
  },

  // 🔥 IMPROVED: Better CORS setup for extension compatibility
  setupCors: async () => {
    try {
      const corsConfiguration = {
        CORSRules: [
          {
            ID: "ScreenCaptureToolCORS",
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
              "*", // 🔥 Allow all origins for presigned URLs
            ],
            ExposeHeaders: ["ETag", "x-amz-meta-*", "x-amz-version-id"],
            MaxAgeSeconds: 3600,
          },
        ],
      };

      const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: corsConfiguration,
      });

      await s3Client.send(command);
      console.log("✅ CORS configuration applied successfully");
      return true;
    } catch (error) {
      console.error("❌ Error setting up CORS:", error);
      throw new Error(`Failed to setup CORS: ${error.message}`);
    }
  },

  setupLifecycle: async () => {
    try {
      const lifecycleConfiguration = {
        Rules: [
          {
            ID: "ScreenCaptureLifecycle",
            Status: "Enabled",
            Filter: {
              Prefix: "cases/",
            },
            Transitions: [
              {
                Days: 30,
                StorageClass: "STANDARD_IA",
              },
              {
                Days: 90,
                StorageClass: "GLACIER",
              },
            ],
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 7,
            },
          },
          {
            ID: "TempFilesCleanup",
            Status: "Enabled",
            Filter: {
              Prefix: "temp/",
            },
            Expiration: {
              Days: 1,
            },
          },
        ],
      };

      const command = new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET_NAME,
        LifecycleConfiguration: lifecycleConfiguration,
      });

      await s3Client.send(command);
      console.log("Lifecycle configuration applied successfully");
      return true;
    } catch (error) {
      console.error("Error setting up lifecycle:", error);
      throw new Error(`Failed to setup lifecycle: ${error.message}`);
    }
  },

  setupVersioning: async () => {
    try {
      const command = new PutBucketVersioningCommand({
        Bucket: BUCKET_NAME,
        VersioningConfiguration: {
          Status: "Enabled",
        },
      });

      await s3Client.send(command);
      console.log("Bucket versioning enabled successfully");
      return true;
    } catch (error) {
      console.error("Error setting up versioning:", error);
      throw new Error(`Failed to setup versioning: ${error.message}`);
    }
  },

  setupPublicAccessBlock: async () => {
    try {
      const command = new PutPublicAccessBlockCommand({
        Bucket: BUCKET_NAME,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      });

      await s3Client.send(command);
      console.log("Public access block configuration applied successfully");
      return true;
    } catch (error) {
      console.error("Error setting up public access block:", error);
      throw new Error(`Failed to setup public access block: ${error.message}`);
    }
  },
  calculateStorageCosts: (
    fileSizeBytes,
    storageClass = "STANDARD",
    isVideo = false
  ) => {
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);

    const pricing = {
      STANDARD: 0.023,
      STANDARD_IA: 0.0125,
      GLACIER: 0.004,
      DEEP_ARCHIVE: 0.00099,
    };

    // Video files might benefit from different storage classes
    const recommendedClass =
      isVideo && fileSizeBytes > 100 * 1024 * 1024 ? "STANDARD_IA" : "STANDARD";

    return {
      monthly: fileSizeGB * (pricing[storageClass] || pricing.STANDARD),
      yearly: fileSizeGB * (pricing[storageClass] || pricing.STANDARD) * 12,
      storageClass,
      recommendedClass,
      sizeGB: fileSizeGB,
      potentialSavings: isVideo
        ? fileSizeGB * (pricing.STANDARD - pricing.STANDARD_IA)
        : 0,
    };
  },
  getBucketStats: async () => {
    try {
      let totalSize = 0;
      let objectCount = 0;
      let continuationToken = null;

      do {
        const command = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          ContinuationToken: continuationToken,
        });

        const result = await s3Client.send(command);

        if (result.Contents) {
          result.Contents.forEach((obj) => {
            totalSize += obj.Size;
            objectCount++;
          });
        }

        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : null;
      } while (continuationToken);

      return {
        totalSize,
        totalSizeGB: totalSize / (1024 * 1024 * 1024),
        objectCount,
        estimatedMonthlyCost: s3Utils.calculateStorageCosts(totalSize).monthly,
      };
    } catch (error) {
      console.error("Error getting bucket stats:", error);
      throw new Error(`Failed to get bucket stats: ${error.message}`);
    }
  },
};

module.exports = s3Utils;
