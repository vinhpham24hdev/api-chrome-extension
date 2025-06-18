const express = require("express");
const s3Utils = require("../utils/s3Utils");
const router = express.Router();

// Basic health check
router.get("/", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    sdkVersion: "aws-sdk-v3",
  });
});

// Detailed health check with service status
router.get("/detailed", async (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    sdkVersion: "aws-sdk-v3",
    services: {},
  };

  // Check AWS S3 connectivity
  try {
    const bucketInfo = await s3Utils.getBucketInfo();
    health.services.s3 = {
      status: bucketInfo.exists ? "healthy" : "bucket_not_found",
      bucket: bucketInfo.name,
      region: bucketInfo.region,
    };

    if (!bucketInfo.exists) {
      health.status = "degraded";
    }
  } catch (error) {
    health.services.s3 = {
      status: "unhealthy",
      error: error.message,
    };
    health.status = "degraded";
  }

  // Check environment variables
  const requiredEnvVars = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET_NAME",
    "JWT_SECRET",
  ];

  const missingEnvVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );
  health.services.environment = {
    status: missingEnvVars.length === 0 ? "healthy" : "missing_variables",
    missingVariables: missingEnvVars,
  };

  if (missingEnvVars.length > 0) {
    health.status = "degraded";
  }

  // Check database (mock check for now)
  health.services.database = {
    status: "healthy",
    type: "in-memory",
    note: "Using mock data store",
  };

  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
