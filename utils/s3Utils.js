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
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { v4: uuidv4 } = require("uuid");

// Configure S3 Client với retry và timeout
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  maxAttempts: 3,
  retryMode: "adaptive",
  requestTimeout: 60000, // 60 seconds
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024; // 100MB
const ALLOWED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo", // .avi
];

const s3Utils = {
  // Generate S3 key for file
  generateS3Key: (caseId, captureType, fileName, userId) => {
    const timestamp = new Date().toISOString().split("T")[0];
    const uniqueId = uuidv4().split("-")[0];
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileExtension = fileName.split('.').pop();

    return `cases/${caseId}/${captureType}/${timestamp}/${uniqueId}_${Date.now()}.${fileExtension}`;
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

    // Validate file extension
    const allowedExtensions = {
      screenshot: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      video: ['webm', 'mp4', 'mov', 'avi']
    };

    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    if (fileExtension && !allowedExtensions[captureType].includes(fileExtension)) {
      errors.push(`File extension .${fileExtension} not allowed for ${captureType}`);
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
        ServerSideEncryption: "AES256",
        Metadata: {
          'uploaded-by': 'screen-capture-tool',
          'upload-timestamp': new Date().toISOString()
        }
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
      const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

      return {
        uploadUrl,
        fileUrl,
        method: "PUT",
        headers: {
          'Content-Type': fileType
        }
      };
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  },

  // Generate presigned POST URL (alternative method)
  generatePresignedPost: async (key, fileType, fileSize, expiresIn = 3600) => {
    try {
      const conditions = [
        ["content-length-range", 1024, MAX_FILE_SIZE],
        ["starts-with", "$Content-Type", fileType.split("/")[0] + "/"],
        ["eq", "$key", key]
      ];

      const fields = {
        key: key,
        "Content-Type": fileType,
        "x-amz-server-side-encryption": "AES256"
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
      console.error('Error generating presigned POST:', error);
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

      const result = await s3Client.send(command);
      console.log(`File deleted successfully: ${key}`);
      return true;
    } catch (error) {
      console.error(`Error deleting file ${key}:`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  },

  // Delete multiple files from S3
  deleteMultipleFiles: async (keys) => {
    try {
      const deletePromises = keys.map(key => s3Utils.deleteFile(key));
      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      console.error('Error deleting multiple files:', error);
      throw new Error(`Failed to delete multiple files: ${error.message}`);
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
      console.error(`Error checking file existence ${key}:`, error);
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
        etag: result.ETag?.replace(/"/g, ''),
        metadata: result.Metadata,
        serverSideEncryption: result.ServerSideEncryption,
        storageClass: result.StorageClass,
      };
    } catch (error) {
      console.error(`Error getting file metadata ${key}:`, error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  },

  // Generate temporary download URL
  generateDownloadUrl: async (key, expiresIn = 3600, filename = null) => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: key,
      };

      // Add filename for download
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

  // List files for a case
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
        etag: obj.ETag?.replace(/"/g, ''),
        storageClass: obj.StorageClass,
      }));
    } catch (error) {
      console.error(`Error listing files for case ${caseId}:`, error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  },

  // Get bucket information
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
      console.error('Error getting bucket info:', error);
      throw error;
    }
  },

  // Create bucket (for setup)
  createBucket: async () => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
      };

      // Add LocationConstraint for regions other than us-east-1
      if (process.env.AWS_REGION !== "us-east-1") {
        params.CreateBucketConfiguration = {
          LocationConstraint: process.env.AWS_REGION,
        };
      }

      const command = new CreateBucketCommand(params);
      await s3Client.send(command);
      
      console.log(`Bucket ${BUCKET_NAME} created successfully`);
      
      // Wait a bit for bucket to be available
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return true;
    } catch (error) {
      if (error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou') {
        console.log(`Bucket ${BUCKET_NAME} already exists`);
        return true;
      }
      console.error('Error creating bucket:', error);
      throw new Error(`Failed to create bucket: ${error.message}`);
    }
  },

  // Setup CORS configuration
  setupCors: async () => {
    try {
      const corsConfiguration = {
        CORSRules: [
          {
            ID: "ScreenCaptureToolCORS",
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
              "chrome-extension://*",
              "moz-extension://*",
              "http://localhost:*",
              "https://localhost:*",
              ...(process.env.CORS_ORIGINS?.split(',') || [])
            ],
            ExposeHeaders: ["ETag", "x-amz-meta-*"],
            MaxAgeSeconds: 3600,
          },
        ],
      };

      const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: corsConfiguration,
      });

      await s3Client.send(command);
      console.log('CORS configuration applied successfully');
      return true;
    } catch (error) {
      console.error('Error setting up CORS:', error);
      throw new Error(`Failed to setup CORS: ${error.message}`);
    }
  },

  // Setup lifecycle configuration
  setupLifecycle: async () => {
    try {
      const lifecycleConfiguration = {
        Rules: [
          {
            ID: "ScreenCaptureLifecycle",
            Status: "Enabled",
            Filter: {
              Prefix: "cases/"
            },
            Transitions: [
              {
                Days: 30,
                StorageClass: "STANDARD_IA"
              },
              {
                Days: 90,
                StorageClass: "GLACIER"
              }
            ],
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 7
            }
          },
          {
            ID: "TempFilesCleanup",
            Status: "Enabled",
            Filter: {
              Prefix: "temp/"
            },
            Expiration: {
              Days: 1
            }
          }
        ]
      };

      const command = new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET_NAME,
        LifecycleConfiguration: lifecycleConfiguration,
      });

      await s3Client.send(command);
      console.log('Lifecycle configuration applied successfully');
      return true;
    } catch (error) {
      console.error('Error setting up lifecycle:', error);
      throw new Error(`Failed to setup lifecycle: ${error.message}`);
    }
  },

  // Setup bucket versioning
  setupVersioning: async () => {
    try {
      const command = new PutBucketVersioningCommand({
        Bucket: BUCKET_NAME,
        VersioningConfiguration: {
          Status: "Enabled"
        }
      });

      await s3Client.send(command);
      console.log('Bucket versioning enabled successfully');
      return true;
    } catch (error) {
      console.error('Error setting up versioning:', error);
      throw new Error(`Failed to setup versioning: ${error.message}`);
    }
  },

  // Setup public access block (security)
  setupPublicAccessBlock: async () => {
    try {
      const command = new PutPublicAccessBlockCommand({
        Bucket: BUCKET_NAME,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true
        }
      });

      await s3Client.send(command);
      console.log('Public access block configuration applied successfully');
      return true;
    } catch (error) {
      console.error('Error setting up public access block:', error);
      throw new Error(`Failed to setup public access block: ${error.message}`);
    }
  },

  // Calculate storage costs (estimation)
  calculateStorageCosts: (fileSizeBytes, storageClass = 'STANDARD') => {
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);
    
    // AWS S3 pricing (approximate, varies by region)
    const pricing = {
      STANDARD: 0.023, // per GB per month
      STANDARD_IA: 0.0125,
      GLACIER: 0.004,
      DEEP_ARCHIVE: 0.00099
    };

    return {
      monthly: fileSizeGB * (pricing[storageClass] || pricing.STANDARD),
      yearly: fileSizeGB * (pricing[storageClass] || pricing.STANDARD) * 12,
      storageClass,
      sizeGB: fileSizeGB
    };
  },

  // Get bucket size and object count
  getBucketStats: async () => {
    try {
      let totalSize = 0;
      let objectCount = 0;
      let continuationToken = null;

      do {
        const command = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          ContinuationToken: continuationToken
        });

        const result = await s3Client.send(command);
        
        if (result.Contents) {
          result.Contents.forEach(obj => {
            totalSize += obj.Size;
            objectCount++;
          });
        }

        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);

      return {
        totalSize,
        totalSizeGB: totalSize / (1024 * 1024 * 1024),
        objectCount,
        estimatedMonthlyCost: s3Utils.calculateStorageCosts(totalSize).monthly
      };
    } catch (error) {
      console.error('Error getting bucket stats:', error);
      throw new Error(`Failed to get bucket stats: ${error.message}`);
    }
  }
};

module.exports = s3Utils;