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
  PutBucketLifecycleConfigurationCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { v4: uuidv4 } = require("uuid");

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024; // 100MB
const ALLOWED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/webm",
  "video/mp4",
  "video/quicktime",
];

const s3Utils = {
  // Generate S3 key for file
  generateS3Key: (caseId, captureType, fileName, userId) => {
    const timestamp = new Date().toISOString().split("T")[0];
    const uniqueId = uuidv4().split("-")[0];
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");

    return `cases/${caseId}/${captureType}/${timestamp}/${uniqueId}_${sanitizedFileName}`;
  },

  // Validate file parameters
  validateFileParams: (fileName, fileType, fileSize, captureType) => {
    const errors = [];

    if (!fileName || fileName.trim().length === 0) {
      errors.push("File name is required");
    }

    if (!fileType) {
      errors.push("File type is required");
    } else if (!ALLOWED_FILE_TYPES.includes(fileType)) {
      errors.push(
        `File type ${fileType} is not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(
          ", "
        )}`
      );
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024);
      errors.push(`File size exceeds ${maxSizeMB}MB limit`);
    }

    if (!captureType || !["screenshot", "video"].includes(captureType)) {
      errors.push('Capture type must be either "screenshot" or "video"');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  },

  // Generate presigned URL for upload (PUT method)
  generatePresignedUrl: async (key, fileType, expiresIn = 3600) => {
    try {
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: fileType,
        ACL: "private",
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
      const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

      return {
        uploadUrl,
        fileUrl,
        method: "PUT",
      };
    } catch (error) {
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  },

  // Generate presigned POST URL (alternative method)
  generatePresignedPost: async (key, fileType, fileSize, expiresIn = 3600) => {
    try {
      const conditions = [
        ["content-length-range", 1024, MAX_FILE_SIZE],
        ["starts-with", "$Content-Type", fileType.split("/")[0] + "/"],
      ];

      const fields = {
        key: key,
        "Content-Type": fileType,
      };

      const { url, fields: presignedFields } = await createPresignedPost(
        s3Client,
        {
          Bucket: BUCKET_NAME,
          Key: key,
          Conditions: conditions,
          Fields: fields,
          Expires: expiresIn,
        }
      );

      const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

      return {
        uploadUrl: url,
        fileUrl,
        fields: presignedFields,
        method: "POST",
      };
    } catch (error) {
      throw new Error(`Failed to generate presigned POST: ${error.message}`);
    }
  },

  // Delete file from S3
  deleteFile: async (key) => {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  },

  // Check if file exists in S3
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

  // Get file metadata from S3
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
        etag: result.ETag,
        metadata: result.Metadata,
      };
    } catch (error) {
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  },

  // Generate temporary download URL
  generateDownloadUrl: async (key, expiresIn = 3600) => {
    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  },

  // List files for a case
  listCaseFiles: async (caseId, prefix = "") => {
    try {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: `cases/${caseId}/${prefix}`,
        MaxKeys: 1000,
      });

      const result = await s3Client.send(command);

      return (result.Contents || []).map((obj) => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        etag: obj.ETag,
      }));
    } catch (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  },

  // Get bucket information
  getBucketInfo: async () => {
    try {
      const command = new HeadBucketCommand({
        Bucket: BUCKET_NAME,
      });

      await s3Client.send(command);
      return {
        exists: true,
        name: BUCKET_NAME,
        region: process.env.AWS_REGION,
      };
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return { exists: false, name: BUCKET_NAME };
      }
      throw error;
    }
  },

  // Create bucket (for setup)
  createBucket: async () => {
    try {
      const command = new CreateBucketCommand({
        Bucket: BUCKET_NAME,
        CreateBucketConfiguration:
          process.env.AWS_REGION !== "us-east-1"
            ? {
                LocationConstraint: process.env.AWS_REGION,
              }
            : undefined,
      });

      await s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error(`Failed to create bucket: ${error.message}`);
    }
  },

  // Setup CORS configuration
  setupCors: async () => {
    try {
      const corsConfiguration = {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
              "chrome-extension://*",
              "moz-extension://*",
              "http://localhost:*",
              "https://localhost:*",
            ],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      };

      const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: corsConfiguration,
      });

      await s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error(`Failed to setup CORS: ${error.message}`);
    }
  },
};

module.exports = s3Utils;
