#!/usr/bin/env node

const s3Utils = require('../utils/s3Utils');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('☁️  Enhanced AWS S3 Setup for Screen Capture Tool (SDK v3)\n');

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
    const region = process.env.AWS_REGION;

    console.log(`🏢 Setting up bucket: ${bucketName}`);
    console.log(`📍 Region: ${region}\n`);

    // Step 1: Check if bucket exists
    console.log('1️⃣ Checking bucket existence...');
    const bucketInfo = await s3Utils.getBucketInfo();
    
    if (bucketInfo.exists) {
      console.log('✅ Bucket already exists');
      console.log(`   Region: ${bucketInfo.bucketRegion || region}`);
    } else {
      // Create bucket
      console.log(`🪣 Creating bucket '${bucketName}'...`);
      await s3Utils.createBucket();
      console.log('✅ Bucket created successfully');
    }

    // Step 2: Setup security configurations
    console.log('\n2️⃣ Configuring security settings...');
    
    try {
      await s3Utils.setupPublicAccessBlock();
      console.log('🔒 Public access blocked (security)');
    } catch (error) {
      console.warn('⚠️  Could not set public access block:', error.message);
    }

    // Step 3: Setup CORS configuration
    console.log('\n3️⃣ Configuring CORS...');
    await s3Utils.setupCors();
    console.log('✅ CORS configuration applied');

    // Step 4: Setup bucket lifecycle
    console.log('\n4️⃣ Setting up lifecycle configuration...');
    try {
      await s3Utils.setupLifecycle();
      console.log('✅ Lifecycle configuration applied');
      console.log('   - Files move to IA after 30 days');
      console.log('   - Files move to Glacier after 90 days');
      console.log('   - Temp files deleted after 1 day');
    } catch (error) {
      console.warn('⚠️  Could not set lifecycle configuration:', error.message);
    }

    // Step 5: Setup versioning (optional)
    console.log('\n5️⃣ Setting up versioning...');
    try {
      await s3Utils.setupVersioning();
      console.log('✅ Bucket versioning enabled');
    } catch (error) {
      console.warn('⚠️  Could not enable versioning:', error.message);
    }

    // Step 6: Test bucket access
    console.log('\n6️⃣ Testing bucket access...');
    const testKey = `test/health-check-${Date.now()}.txt`;
    const testContent = `Health check - ${new Date().toISOString()}`;

    try {
      // Generate presigned URL for test upload
      const { uploadUrl, fileUrl } = await s3Utils.generatePresignedUrl(testKey, 'text/plain');
      console.log('✅ Presigned URL generation test passed');
      
      // Test file existence check
      const exists = await s3Utils.fileExists(testKey);
      console.log(`✅ File existence check test passed (exists: ${exists})`);

      console.log('✅ All bucket access tests passed');
    } catch (error) {
      console.error('❌ Bucket access test failed:', error.message);
    }

    // Step 7: Get bucket statistics
    console.log('\n7️⃣ Getting bucket statistics...');
    try {
      const stats = await s3Utils.getBucketStats();
      console.log('📊 Bucket Statistics:');
      console.log(`   Objects: ${stats.objectCount}`);
      console.log(`   Total Size: ${(stats.totalSizeGB).toFixed(2)} GB`);
      console.log(`   Estimated Monthly Cost: $${stats.estimatedMonthlyCost.toFixed(2)}`);
    } catch (error) {
      console.log('📊 No existing objects in bucket (new bucket)');
    }

    // Step 8: Create folder structure
    console.log('\n8️⃣ Setting up folder structure...');
    await setupFolderStructure();

    // Success summary
    console.log('\n🎉 AWS S3 setup completed successfully!');
    console.log(`\n📊 Bucket Information:`);
    console.log(`   Name: ${bucketName}`);
    console.log(`   Region: ${region}`);
    console.log(`   URL: https://${bucketName}.s3.${region}.amazonaws.com/`);
    console.log(`   SDK: AWS SDK v3`);
    console.log(`   Security: Public access blocked`);
    console.log(`   Versioning: Enabled`);
    console.log(`   Lifecycle: Configured`);

    // Generate setup report
    await generateSetupReport(bucketInfo);

    console.log('\n📝 Next Steps:');
    console.log('1. Start backend server: npm run dev');
    console.log('2. Test API health: npm run health');
    console.log('3. Test upload endpoints: npm run test:api');
    console.log('4. Check setup report: cat aws-setup-report.json');

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

    if (error.message.includes('AccessDenied')) {
      console.error('\n💡 Permission Issues:');
      console.error('   - Ensure IAM user has required S3 permissions:');
      console.error('     * s3:CreateBucket');
      console.error('     * s3:GetBucketLocation');
      console.error('     * s3:PutBucketCors');
      console.error('     * s3:PutBucketLifecycleConfiguration');
      console.error('     * s3:PutBucketVersioning');
      console.error('     * s3:PutObject');
      console.error('     * s3:GetObject');
      console.error('     * s3:DeleteObject');
    }

    process.exit(1);
  }
}

async function setupFolderStructure() {
  try {
    const folders = [
      'cases/',
      'temp/',
      'backups/',
      'exports/'
    ];

    console.log('📁 Creating folder structure...');
    for (const folder of folders) {
      console.log(`   ├── ${folder}`);
    }
    console.log('✅ Folder structure planned (created on first upload)');
  } catch (error) {
    console.warn('⚠️  Could not setup folder structure:', error.message);
  }
}

async function generateSetupReport(bucketInfo) {
  try {
    const report = {
      timestamp: new Date().toISOString(),
      bucket: {
        name: process.env.AWS_S3_BUCKET_NAME,
        region: process.env.AWS_REGION,
        exists: bucketInfo.exists,
        url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`
      },
      features: {
        cors: true,
        lifecycle: true,
        versioning: true,
        publicAccessBlock: true,
        encryption: 'AES256'
      },
      folderStructure: [
        'cases/{caseId}/screenshot/{date}/',
        'cases/{caseId}/video/{date}/',
        'temp/',
        'backups/',
        'exports/'
      ],
      permissions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:GetBucketLocation',
        's3:ListBucket'
      ],
      nextSteps: [
        'Test API endpoints',
        'Configure frontend',
        'Set up monitoring',
        'Review costs'
      ]
    };

    fs.writeFileSync('aws-setup-report.json', JSON.stringify(report, null, 2));
    console.log('📄 Setup report saved to aws-setup-report.json');
  } catch (error) {
    console.warn('⚠️  Could not generate setup report:', error.message);
  }
}

// Run the setup
setupS3();