// scripts/testAWSPermissions.js - Test AWS permissions
require('dotenv').config();
const { S3Client, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand } = require("@aws-sdk/client-s3");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

async function testAWSPermissions() {
  console.log('🔍 Testing AWS Permissions...\n');

  // 1. Test STS (Who Am I?)
  console.log('1. 👤 Testing AWS Identity...');
  try {
    const stsClient = new STSClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    });

    const identityCommand = new GetCallerIdentityCommand({});
    const identity = await stsClient.send(identityCommand);
    
    console.log('✅ AWS Identity confirmed:');
    console.log(`   User ARN: ${identity.Arn}`);
    console.log(`   Account ID: ${identity.Account}`);
    console.log(`   User ID: ${identity.UserId}\n`);
  } catch (error) {
    console.error('❌ AWS Identity test failed:', error.message);
    console.error('   🔧 Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY\n');
    return;
  }

  // 2. Test S3 Client Setup
  console.log('2. 🪣 Testing S3 Client...');
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    signatureVersion: 'v4',
  });

  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  console.log(`   Target bucket: ${bucketName}`);
  console.log(`   Region: ${process.env.AWS_REGION}\n`);

  // 3. Test Bucket Access
  console.log('3. 📋 Testing Bucket Access...');
  try {
    const headCommand = new HeadBucketCommand({ Bucket: bucketName });
    await s3Client.send(headCommand);
    console.log('✅ Bucket access confirmed\n');
  } catch (error) {
    console.error('❌ Bucket access failed:', error.message);
    
    if (error.name === 'NotFound') {
      console.error('   🔧 Bucket does not exist or wrong name');
    } else if (error.name === 'AccessDenied') {
      console.error('   🔧 IAM user lacks bucket permissions');
    } else if (error.name === 'PermanentRedirect') {
      console.error('   🔧 Bucket exists in different region');
    }
    console.log('');
  }

  // 4. Test List Objects
  console.log('4. 📂 Testing List Objects...');
  try {
    const listCommand = new ListObjectsV2Command({ 
      Bucket: bucketName,
      MaxKeys: 1
    });
    const listResult = await s3Client.send(listCommand);
    console.log('✅ List objects permission confirmed');
    console.log(`   Objects found: ${listResult.KeyCount || 0}\n`);
  } catch (error) {
    console.error('❌ List objects failed:', error.message);
    console.error('   🔧 Need s3:ListBucket permission\n');
  }

  // 5. Test Put Object (with test file)
  console.log('5. ⬆️ Testing Put Object...');
  try {
    const testKey = `test/permissions-test-${Date.now()}.txt`;
    const testContent = 'This is a test file to verify upload permissions';
    
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain'
    });
    
    await s3Client.send(putCommand);
    console.log('✅ Put object permission confirmed');
    console.log(`   Test file uploaded: ${testKey}\n`);
  } catch (error) {
    console.error('❌ Put object failed:', error.message);
    
    if (error.name === 'AccessDenied') {
      console.error('   🔧 Need s3:PutObject permission');
      console.error('   🔧 Check IAM policy allows PutObject on bucket/*');
    }
    console.log('');
  }

  // 6. Required IAM Policy
  console.log('6. 📋 Required IAM Policy:');
  console.log(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::${bucketName}/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::${bucketName}"
    }
  ]
}`);

  console.log('\n🎯 Next Steps:');
  console.log('   1. Apply the IAM policy above to your user');
  console.log('   2. Wait 1-2 minutes for IAM changes to propagate');
  console.log('   3. Run this test again');
  console.log('   4. If still failing, check bucket exists and region is correct');
}

// Run test if called directly
if (require.main === module) {
  testAWSPermissions().catch(console.error);
}

module.exports = testAWSPermissions;