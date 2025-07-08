#!/usr/bin/env node

// scripts/setup-aws.js - Simple AWS S3 Setup
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutPublicAccessBlockCommand,
  ListObjectsV2Command
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

require('dotenv').config();

console.log('🚀 AWS S3 Setup for Screen Capture Tool\n');

// Validate environment variables
function validateEnv() {
  const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease check your .env file');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
  console.log(`   Bucket: ${process.env.AWS_S3_BUCKET_NAME}`);
  console.log(`   Region: ${process.env.AWS_REGION}`);
  console.log(`   Key ID: ${process.env.AWS_ACCESS_KEY_ID.substring(0, 8)}...`);
}

// Create S3 client
function createS3Client() {
  try {
    const client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    console.log('✅ S3 client created');
    return client;
  } catch (error) {
    console.error('❌ Failed to create S3 client:', error.message);
    process.exit(1);
  }
}

// Check if bucket exists
async function checkBucketExists(s3Client, bucketName) {
  try {
    console.log('\n🔍 Checking if bucket exists...');
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log('✅ Bucket already exists');
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      console.log('ℹ️  Bucket does not exist, will create it');
      return false;
    }
    console.error('❌ Error checking bucket:', error.message);
    throw error;
  }
}

// Create bucket
async function createBucket(s3Client, bucketName, region) {
  try {
    console.log('\n🪣 Creating bucket...');
    
    const params = { Bucket: bucketName };
    
    // Add LocationConstraint for regions other than us-east-1
    if (region !== 'us-east-1') {
      params.CreateBucketConfiguration = {
        LocationConstraint: region
      };
    }
    
    await s3Client.send(new CreateBucketCommand(params));
    console.log('✅ Bucket created successfully');
    
    // Wait for bucket to be available
    console.log('⏳ Waiting for bucket to be ready...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    if (error.name === 'BucketAlreadyExists') {
      console.log('ℹ️  Bucket already exists (owned by someone else)');
      console.log('💡 Try a different bucket name in your .env file');
      process.exit(1);
    } else if (error.name === 'BucketAlreadyOwnedByYou') {
      console.log('✅ Bucket already exists and owned by you');
    } else {
      console.error('❌ Failed to create bucket:', error.message);
      throw error;
    }
  }
}

// Setup CORS
async function setupCORS(s3Client, bucketName) {
  try {
    console.log('\n🌐 Setting up CORS...');
    
    const corsConfiguration = {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          AllowedOrigins: [
            'chrome-extension://*',
            'moz-extension://*',
            'http://localhost:*',
            'https://localhost:*'
          ],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    };
    
    await s3Client.send(new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: corsConfiguration,
    }));
    
    console.log('✅ CORS configuration applied');
  } catch (error) {
    console.warn('⚠️  Could not set CORS:', error.message);
  }
}

// Setup security (block public access)
async function setupSecurity(s3Client, bucketName) {
  try {
    console.log('\n🔒 Setting up security...');
    
    await s3Client.send(new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true
      }
    }));
    
    console.log('✅ Public access blocked (security enabled)');
  } catch (error) {
    console.warn('⚠️  Could not set public access block:', error.message);
  }
}

// Test bucket access
async function testBucketAccess(s3Client, bucketName) {
  try {
    console.log('\n🧪 Testing bucket access...');
    
    // Test 1: List objects
    await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }));
    console.log('✅ List objects test passed');
    
    // Test 2: Generate presigned URL
    const testKey = `test/access-test-${Date.now()}.txt`;
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: testKey,
      ContentType: 'text/plain'
    });
    
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log('✅ Presigned URL generation test passed');
    
    console.log('✅ All access tests passed');
    
  } catch (error) {
    console.error('❌ Bucket access test failed:', error.message);
    throw error;
  }
}

// Get bucket stats
async function getBucketStats(s3Client, bucketName) {
  try {
    console.log('\n📊 Getting bucket statistics...');
    
    const response = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }));
    const objectCount = response.KeyCount || 0;
    const totalSize = (response.Contents || []).reduce((sum, obj) => sum + obj.Size, 0);
    
    console.log(`   Objects: ${objectCount}`);
    console.log(`   Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    
    if (objectCount === 0) {
      console.log('   This is a new bucket - ready for use!');
    }
    
  } catch (error) {
    console.log('   Could not get stats (this is normal for new buckets)');
  }
}

// Main setup function
async function setupAWS() {
  try {
    console.log('Starting AWS S3 setup...\n');
    
    // Step 1: Validate environment
    validateEnv();
    
    // Step 2: Create S3 client
    const s3Client = createS3Client();
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;
    
    // Step 3: Check/Create bucket
    const bucketExists = await checkBucketExists(s3Client, bucketName);
    if (!bucketExists) {
      await createBucket(s3Client, bucketName, region);
    }
    
    // Step 4: Setup CORS
    await setupCORS(s3Client, bucketName);
    
    // Step 5: Setup security
    await setupSecurity(s3Client, bucketName);
    
    // Step 6: Test access
    await testBucketAccess(s3Client, bucketName);
    
    // Step 7: Get stats
    await getBucketStats(s3Client, bucketName);
    
    // Success summary
    console.log('\n🎉 AWS S3 setup completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   Bucket Name: ${bucketName}`);
    console.log(`   Region: ${region}`);
    console.log(`   URL: https://${bucketName}.s3.${region}.amazonaws.com/`);
    console.log(`   Security: Enabled`);
    console.log(`   CORS: Configured`);
    console.log(`   Status: Ready for use`);
    
    console.log('\n📝 Next Steps:');
    console.log('   1. Start API server: npm run dev');
    console.log('   2. Test API health: npm run health');
    console.log('   3. Test upload: npm run test:api');
    
  } catch (error) {
    console.error('\n❌ AWS setup failed:', error.message);
    
    if (error.message.includes('credentials') || error.message.includes('Invalid')) {
      console.error('\n💡 Credential Issues:');
      console.error('   - Double-check your AWS_ACCESS_KEY_ID');
      console.error('   - Double-check your AWS_SECRET_ACCESS_KEY');
      console.error('   - Make sure the IAM user has S3 permissions');
    }
    
    if (error.message.includes('region') || error.message.includes('location')) {
      console.error('\n💡 Region Issues:');
      console.error('   - Check your AWS_REGION setting');
      console.error('   - Try ap-southeast-1 (Singapore) or us-east-1');
    }
    
    if (error.message.includes('bucket') || error.message.includes('name')) {
      console.error('\n💡 Bucket Issues:');
      console.error('   - Bucket names must be globally unique');
      console.error('   - Try adding timestamp: your-app-name-2024-dev');
      console.error('   - Only lowercase letters, numbers, and hyphens allowed');
    }
    
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check your .env file exists and has correct values');
    console.error('   2. Verify IAM user has AmazonS3FullAccess policy');
    console.error('   3. Try a different bucket name');
    console.error('   4. Check AWS region is correct');
    
    process.exit(1);
  }
}

// Run the setup
if (require.main === module) {
  setupAWS();
}

module.exports = { setupAWS };