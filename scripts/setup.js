const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🚀 Setting up Screen Capture API Backend...\n');

function generateJWTSecret() {
  return crypto.randomBytes(64).toString('hex');
}

function updateEnvFile() {
  const envPath = '.env';
  
  if (!fs.existsSync(envPath)) {
    console.log('❌ .env file not found');
    return false;
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  
  // Generate JWT secret if it's the default
  if (envContent.includes('your_jwt_secret_here_change_in_production')) {
    const newSecret = generateJWTSecret();
    envContent = envContent.replace(
      'your_jwt_secret_here_change_in_production',
      newSecret
    );
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Generated new JWT secret');
  }

  return true;
}

function checkRequiredEnvVars() {
  const required = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_S3_BUCKET_NAME'
  ];

  const missing = required.filter(varName => {
    const value = process.env[varName];
    return !value || value.includes('your_') || value.includes('_here');
  });

  if (missing.length > 0) {
    console.log('⚠️  Missing or placeholder environment variables:');
    missing.forEach(varName => {
      console.log(`   - ${varName}`);
    });
    console.log('\n📝 Please edit .env file with your actual AWS credentials');
    return false;
  }

  console.log('✅ All required environment variables are set');
  return true;
}

function displayInstructions() {
  console.log('\n📋 Setup completed! Next steps:\n');
  
  if (!checkRequiredEnvVars()) {
    console.log('1. 🔧 Configure AWS credentials in .env:');
    console.log('   - Get credentials from AWS Console → IAM → Users');
    console.log('   - Update AWS_ACCESS_KEY_ID');
    console.log('   - Update AWS_SECRET_ACCESS_KEY');
    console.log('   - Update AWS_S3_BUCKET_NAME\n');
  }
  
  console.log('2. 🪣 Create S3 bucket (if not exists):');
  console.log('   aws s3 mb s3://screen-capture-tool-dev --region us-east-1\n');
  
  console.log('3. 🚀 Start the development server:');
  console.log('   npm run dev\n');
  
  console.log('4. 🧪 Test the API:');
  console.log('   curl http://localhost:3001/health');
  console.log('   curl http://localhost:3001/api\n');
  
  console.log('5. 🔗 Next: Add route implementations');
  console.log('   - Authentication routes');
  console.log('   - File upload routes');
  console.log('   - S3 integration\n');

  console.log('📚 Useful commands:');
  console.log('   npm run health       # Check if server is running');
  console.log('   npm run check:config # Validate configuration');
  console.log('   npm run dev          # Start development server');
  console.log('   npm test             # Run tests');
}

// Main setup
require('dotenv').config();
updateEnvFile();
displayInstructions();
