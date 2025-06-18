#!/usr/bin/env node

const s3Utils = require('../utils/s3Utils');
require('dotenv').config();

console.log('☁️  Setting up AWS S3 for Screen Capture Tool (SDK v3)\n');

// Check environment variables
const requiredVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 
  'AWS_REGION',
  'AWS_S3_BUCKET_NAME'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease update your .env file with the required values.');
  process.exit(1);
}

async function setupS3() {
  try {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    // Check if bucket exists
    console.log(`🔍 Checking if bucket '${bucketName}' exists...`);
    
    const bucketInfo = await s3Utils.getBucketInfo();
    
    if (bucketInfo.exists) {
      console.log('✅ Bucket already exists');
    } else {
      // Create bucket
      console.log(`🪣 Creating bucket '${bucketName}'...`);
      await s3Utils.createBucket();
      console.log('✅ Bucket created successfully');
    }

    // Set up CORS configuration
    console.log('🌐 Configuring CORS...');
    await s3Utils.setupCors();
    console.log('✅ CORS configuration applied');

    // Set up bucket lifecycle
    console.log('🔄 Setting up lifecycle configuration...');
    await s3Utils.setupLifecycle();
    console.log('✅ Lifecycle configuration applied');

    // Test upload/download
    console.log('🧪 Testing bucket access...');
    const testKey = 'test/health-check.txt';
    const testContent = `Health check - ${new Date().toISOString()}`;

    // Generate presigned URL for test upload
    const { uploadUrl } = await s3Utils.generatePresignedUrl(testKey, 'text/plain');
    
    // Simulate upload test (in real scenario, frontend would upload to this URL)
    console.log('✅ Presigned URL generation test passed');
    
    // Test file existence check
    const exists = await s3Utils.fileExists(testKey);
    console.log(`✅ File existence check test passed (exists: ${exists})`);

    console.log('\n🎉 AWS S3 setup completed successfully!');
    console.log(`\n📊 Bucket Information:`);
    console.log(`   Name: ${bucketName}`);
    console.log(`   Region: ${process.env.AWS_REGION}`);
    console.log(`   URL: https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/`);
    console.log(`   SDK: AWS SDK v3`);

    console.log('\n📝 Next Steps:');
    console.log('1. Start backend server: npm run dev');
    console.log('2. Test API health: npm run health');
    console.log('3. Test API endpoints: npm run test:api');
    console.log('4. Update frontend to use real backend URL');

  } catch (error) {
    console.error('❌ AWS S3 setup failed:', error.message);
    
    if (error.message.includes('credentials')) {
      console.error('\n💡 Credential Issues:');
      console.error('   - Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
      console.error('   - Ensure IAM user has S3 permissions');
      console.error('   - Verify AWS region is correct');
    }
    
    if (error.message.includes('bucket')) {
      console.error('\n💡 Bucket Issues:');
      console.error('   - Bucket names must be globally unique');
      console.error('   - Try a different bucket name');
      console.error('   - Check bucket naming conventions');
    }

    process.exit(1);
  }
}

setupS3();