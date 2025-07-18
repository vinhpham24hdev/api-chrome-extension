#!/usr/bin/env node

// scripts/complete-reset.js - Complete database reset with correct passwords
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

async function completeReset() {
    console.log('🔄 Complete database reset with correct passwords...\n');

    try {
        // Test database connection
        await db.query('SELECT NOW()');
        console.log('✅ Database connection established');

        // Step 1: Drop all tables
        console.log('\n🗑️ Step 1: Dropping all existing tables...');
        
        const tablesResult = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
        `);
        
        const tables = tablesResult.rows.map(row => row.table_name);
        console.log('📋 Found tables:', tables);

        if (tables.length > 0) {
            // Drop in correct order
            const dropOrder = ['audit_logs', 'sessions', 'files', 'cases', 'users'];
            
            for (const tableName of dropOrder) {
                if (tables.includes(tableName)) {
                    console.log(`   Dropping ${tableName}...`);
                    await db.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
                }
            }
            
            // Drop any remaining tables
            const remainingTables = tables.filter(t => !dropOrder.includes(t));
            for (const tableName of remainingTables) {
                console.log(`   Dropping ${tableName}...`);
                await db.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
            }
        }

        // Drop functions
        await db.query('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
        console.log('✅ All tables and functions dropped');

        // Step 2: Create schema WITHOUT the fake user inserts
        console.log('\n📊 Step 2: Creating database schema...');
        
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        let schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('   📝 Original schema length:', schema.length);
        
        // Remove INSERT INTO users statements using more precise regex
        schema = schema.replace(/-- Insert default admin user[\s\S]*?ON CONFLICT \(username\) DO NOTHING;/g, '');
        schema = schema.replace(/-- Insert demo user[\s\S]*?ON CONFLICT \(username\) DO NOTHING;/g, '');
        schema = schema.replace(/-- Insert sample cases[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/g, '');
        
        console.log('   📝 Cleaned schema length:', schema.length);
        
        // Execute the entire schema as one query to handle $ properly
        try {
            console.log('   📝 Executing complete schema...');
            await db.query(schema);
            console.log('✅ Schema executed successfully');
        } catch (schemaError) {
            console.log('⚠️ Schema execution failed, trying statement by statement...');
            console.log('Error:', schemaError.message);
            
            // Fallback: try to execute individual statements but handle $ blocks properly
            const statements = [];
            let currentStatement = '';
            let inDollarQuote = false;
            let dollarTag = '';
            
            const lines = schema.split('\n');
            
            for (const line of lines) {
                if (!inDollarQuote) {
                    // Check if this line starts a dollar-quoted string
                    const dollarMatch = line.match(/\$([^$]*)\$/);
                    if (dollarMatch) {
                        dollarTag = dollarMatch[0];
                        inDollarQuote = true;
                    }
                } else {
                    // Check if this line ends the dollar-quoted string
                    if (line.includes(dollarTag)) {
                        inDollarQuote = false;
                        dollarTag = '';
                    }
                }
                
                currentStatement += line + '\n';
                
                // If we're not in a dollar quote and line ends with semicolon, it's a complete statement
                if (!inDollarQuote && line.trim().endsWith(';')) {
                    statements.push(currentStatement.trim());
                    currentStatement = '';
                }
            }
            
            // Add any remaining statement
            if (currentStatement.trim()) {
                statements.push(currentStatement.trim());
            }
            
            console.log(`   📝 Found ${statements.length} properly parsed statements`);
            
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                if (statement.length > 0) {
                    try {
                        console.log(`   Executing statement ${i + 1}/${statements.length}...`);
                        await db.query(statement);
                    } catch (stmtError) {
                        console.log(`   ⚠️ Statement ${i + 1} failed: ${stmtError.message}`);
                        // Continue with next statement unless it's a critical error
                        if (!stmtError.message.includes('already exists')) {
                            throw stmtError;
                        }
                    }
                }
            }
        }
        console.log('✅ Clean database schema created (without fake users)');

        // Step 3: Import real data from mockData
        console.log('\n📁 Step 3: Importing data from mockData...');
        
        try {
            const mockData = require('../utils/mockData');
            
            // Import users with correct hashes
            if (mockData.users && mockData.users.length > 0) {
                console.log('👥 Importing users...');
                for (const user of mockData.users) {
                    const result = await db.query(`
                        INSERT INTO users (username, email, password_hash, role) 
                        VALUES ($1, $2, $3, $4)
                        RETURNING id, username, email, role
                    `, [user.username, user.email, user.password, user.role]);
                    
                    const newUser = result.rows[0];
                    console.log(`   ✅ Created: ${newUser.username} (${newUser.email}) - ${newUser.role}`);
                }
            }

            // Import cases
            if (mockData.cases && mockData.cases.length > 0) {
                console.log('📁 Importing cases...');
                for (const case_ of mockData.cases) {
                    await db.query(`
                        INSERT INTO cases (id, title, description, status, priority, tags, metadata) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        case_.id,
                        case_.title,
                        case_.description,
                        case_.status,
                        case_.priority,
                        case_.tags || [],
                        JSON.stringify(case_.metadata || {})
                    ]);
                }
                console.log(`   ✅ Imported ${mockData.cases.length} cases`);
            }

            console.log('✅ MockData imported successfully');
            
        } catch (mockError) {
            console.log('⚠️ MockData import failed:', mockError.message);
            console.log('📝 Creating default users manually...');
            
            // Fallback: Create users manually with correct hashes
            const adminHash = await bcrypt.hash('admin123', 10);
            const demoHash = await bcrypt.hash('password', 10);
            
            await db.query(`
                INSERT INTO users (username, email, password_hash, role) 
                VALUES ('admin', 'admin@screencapture.com', $1, 'admin')
            `, [adminHash]);
            
            await db.query(`
                INSERT INTO users (username, email, password_hash, role) 
                VALUES ('demo', 'demo@screencapture.com', $1, 'user')
            `, [demoHash]);
            
            console.log('✅ Default users created with correct hashes');
        }

        // Step 4: Test passwords
        console.log('\n🧪 Step 4: Testing passwords...');
        
        const users = await db.query(`
            SELECT username, email, password_hash, role 
            FROM users 
            ORDER BY username
        `);
        
        console.log(`📊 Found ${users.rows.length} users in database`);
        
        for (const user of users.rows) {
            const testPassword = user.username === 'admin' ? 'admin123' : 'password';
            console.log(`\n   Testing ${user.username}:`);
            console.log(`      Email: ${user.email}`);
            console.log(`      Role: ${user.role}`);
            console.log(`      Hash: ${user.password_hash.substring(0, 30)}...`);
            
            try {
                const isValid = await bcrypt.compare(testPassword, user.password_hash);
                console.log(`      Password '${testPassword}': ${isValid ? '✅ VALID' : '❌ INVALID'}`);
                
                if (isValid) {
                    console.log(`      🎉 Login: username=${user.username}, password=${testPassword}`);
                }
            } catch (error) {
                console.log(`      ❌ Password test error: ${error.message}`);
            }
        }

        // Step 5: Summary
        console.log('\n📊 Final Summary:');
        const finalUserCount = await db.query('SELECT COUNT(*) FROM users');
        const finalCaseCount = await db.query('SELECT COUNT(*) FROM cases');
        const finalFileCount = await db.query('SELECT COUNT(*) FROM files');
        
        console.log(`   Users: ${finalUserCount.rows[0].count}`);
        console.log(`   Cases: ${finalCaseCount.rows[0].count}`);
        console.log(`   Files: ${finalFileCount.rows[0].count}`);

        console.log('\n🎉 Complete database reset successful!');
        console.log('\n📋 LOGIN CREDENTIALS:');
        console.log('   👤 Demo User:  username=demo, password=password');
        console.log('   👤 Admin User: username=admin, password=admin123');

    } catch (error) {
        console.error('❌ Complete reset failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        // Connection cleanup
        try {
            if (typeof db.end === 'function') {
                await db.end();
            } else if (typeof db.close === 'function') {
                await db.close();
            } else if (typeof db.destroy === 'function') {
                await db.destroy();
            }
        } catch (closeError) {
            console.log('ℹ️ Connection cleanup not needed or failed:', closeError.message);
        }
        process.exit(0);
    }
}

completeReset();