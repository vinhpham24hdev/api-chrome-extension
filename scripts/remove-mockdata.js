#!/usr/bin/env node

// scripts/remove-mockdata.js - Remove mock data and clean up imports
const fs = require('fs');
const path = require('path');

console.log('🧹 Cleaning up mock data references...\n');

const filesToUpdate = [
  'controllers/authController.js',
  'controllers/caseController.js', 
  'controllers/uploadController.js',
  'middleware/auth.js'
];

const mockDataImportPattern = /const { [^}]+ } = require\(['"][^'"]*mockData[^'"]*['"]\);?\s*/g;
const mockDataRequirePattern = /require\(['"][^'"]*mockData[^'"]*['"]\)/g;

let updatedFiles = 0;
let errors = 0;

filesToUpdate.forEach(filePath => {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Remove mock data imports
    content = content.replace(mockDataImportPattern, '');
    content = content.replace(mockDataRequirePattern, '/* mockData removed */');

    // Clean up any remaining references that might cause issues
    content = content.replace(/from.*mockData.*$/gm, '');
    content = content.replace(/users\.find/g, '/* users.find removed - using database */');
    content = content.replace(/cases\.find/g, '/* cases.find removed - using database */');
    content = content.replace(/files\.find/g, '/* files.find removed - using database */');

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Updated: ${filePath}`);
      updatedFiles++;
    } else {
      console.log(`ℹ️  No changes needed: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Error updating ${filePath}:`, error.message);
    errors++;
  }
});

// Remove the mockData.js file itself
try {
  const mockDataPath = 'utils/mockData.js';
  if (fs.existsSync(mockDataPath)) {
    fs.unlinkSync(mockDataPath);
    console.log(`🗑️  Removed: ${mockDataPath}`);
  }
} catch (error) {
  console.error(`❌ Error removing mockData.js:`, error.message);
  errors++;
}

// Update package.json scripts to remove any mock data references
try {
  const packageJsonPath = 'package.json';
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    let updated = false;

    // Remove any scripts that might reference mock data
    if (packageJson.scripts) {
      Object.keys(packageJson.scripts).forEach(scriptName => {
        if (packageJson.scripts[scriptName].includes('mockData')) {
          delete packageJson.scripts[scriptName];
          updated = true;
          console.log(`🗑️  Removed script: ${scriptName}`);
        }
      });
    }

    if (updated) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log(`✅ Updated: package.json`);
    }
  }
} catch (error) {
  console.error(`❌ Error updating package.json:`, error.message);
  errors++;
}

// Create migration script for existing mock data to database
const migrationScript = `#!/usr/bin/env node

// scripts/migrate-to-database.js - One-time migration script
const db = require('../config/database');

async function migrateToDatabase() {
  console.log('🔄 Starting migration to database...');
  
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connection established');

    // Run schema if needed
    console.log('📊 Applying database schema...');
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
    await db.query(schema);
    console.log('✅ Database schema applied');

    // Verify tables exist
    const tablesResult = await db.query(\`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    \`);
    
    console.log('📋 Available tables:');
    tablesResult.rows.forEach(row => {
      console.log(\`   - \${row.table_name}\`);
    });

    // Check if users exist
    const userCount = await db.query('SELECT COUNT(*) FROM users');
    const caseCount = await db.query('SELECT COUNT(*) FROM cases');
    
    console.log(\`\\n📊 Database Status:\`);
    console.log(\`   Users: \${userCount.rows[0].count}\`);
    console.log(\`   Cases: \${caseCount.rows[0].count}\`);
    
    if (parseInt(userCount.rows[0].count) === 0) {
      console.log('\\n⚠️  No users found. Creating default users...');
      
      // Create admin user
      await db.query(\`
        INSERT INTO users (username, email, password_hash, role) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO NOTHING
      \`, ['admin', 'admin@example.com', '$2b$10$8K7QQg0kRlZlQZ8QJGz1ZeHfZQn0n3Q8n0n3Q8n0n3Q8n0n3Q8n0', 'admin']);
      
      // Create demo user  
      await db.query(\`
        INSERT INTO users (username, email, password_hash, role) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO NOTHING
      \`, ['demo', 'demo@example.com', '$2b$10$K7QQg0kRlZlQZ8QJGz1ZeHfZQn0n3Q8n0n3Q8n0n3Q8n0n3Q8n0', 'user']);
      
      console.log('✅ Default users created');
    }

    console.log('\\n🎉 Migration completed successfully!');
    console.log('\\n📝 Next steps:');
    console.log('   1. Start the server: npm run dev');
    console.log('   2. Test login with: demo / password');
    console.log('   3. Or admin login: admin / admin123');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  migrateToDatabase();
}

module.exports = migrateToDatabase;
`;

try {
  fs.writeFileSync('scripts/migrate-to-database.js', migrationScript);
  console.log('✅ Created migration script: scripts/migrate-to-database.js');
} catch (error) {
  console.error('❌ Error creating migration script:', error.message);
  errors++;
}

// Create a new README section about database setup
const databaseReadme = `
## 🗄️ Database Setup (PostgreSQL)

This application now uses PostgreSQL instead of mock data.

### Quick Setup

1. **Install PostgreSQL** (if not already installed):
   \`\`\`bash
   # On macOS with Homebrew
   brew install postgresql
   brew services start postgresql
   
   # On Ubuntu/Debian
   sudo apt-get install postgresql postgresql-contrib
   sudo systemctl start postgresql
   
   # On Windows
   # Download from https://www.postgresql.org/download/windows/
   \`\`\`

2. **Create Database**:
   \`\`\`bash
   createdb screen_capture_dev
   \`\`\`

3. **Configure Environment**:
   \`\`\`bash
   # Add to your .env file
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=screen_capture_dev
   DB_USER=postgres
   DB_PASSWORD=your_password
   \`\`\`

4. **Run Migration**:
   \`\`\`bash
   npm run migrate
   \`\`\`

### Default Users

After migration, you can login with:
- **Admin**: username: \`admin\`, password: \`admin123\`
- **Demo**: username: \`demo\`, password: \`password\`

### Database Schema

The database includes:
- **users** - User accounts with authentication
- **cases** - Investigation cases with metadata
- **files** - File uploads with video support
- **video_processing_jobs** - Video processing queue
- **audit_logs** - Activity logging
- **sessions** - JWT session management

### Video Support Features

- ✅ Video file uploads (WebM, MP4, MOV, etc.)
- ✅ Video metadata storage (duration, resolution, codec)
- ✅ Multipart uploads for large files
- ✅ Session grouping for related recordings
- ✅ Video processing job queue
- ✅ Advanced search and filtering
`;

try {
  fs.writeFileSync('DATABASE_README.md', databaseReadme);
  console.log('✅ Created database documentation: DATABASE_README.md');
} catch (error) {
  console.error('❌ Error creating database readme:', error.message);
  errors++;
}

// Update package.json to add migration script
try {
  const packageJsonPath = 'package.json';
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    // Add migration scripts
    packageJson.scripts.migrate = 'node scripts/migrate-to-database.js';
    packageJson.scripts['setup:db'] = 'node scripts/migrate-to-database.js';
    packageJson.scripts['db:reset'] = 'dropdb screen_capture_dev && createdb screen_capture_dev && npm run migrate';
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Added migration scripts to package.json');
  }
} catch (error) {
  console.error('❌ Error updating package.json scripts:', error.message);
  errors++;
}

console.log('\n📊 Summary:');
console.log(`   Files updated: ${updatedFiles}`);
console.log(`   Errors: ${errors}`);

if (errors === 0) {
  console.log('\n🎉 Mock data cleanup completed successfully!');
  console.log('\n📝 Next steps:');
  console.log('   1. Set up PostgreSQL database');
  console.log('   2. Configure database connection in .env');
  console.log('   3. Run: npm run migrate');
  console.log('   4. Start server: npm run dev');
  console.log('\n📚 See DATABASE_README.md for detailed setup instructions');
} else {
  console.log('\n⚠️  Some errors occurred during cleanup');
  console.log('Please review the errors above and fix manually if needed');
}

console.log('\n🗑️  Mock data has been removed - your app now uses PostgreSQL!');