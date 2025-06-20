#!/usr/bin/env node

// scripts/migrate-to-postgres.js - Migration from mock data to PostgreSQL
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function migrate() {
    console.log('🔄 Migrating from mock data to PostgreSQL...\n');

    try {
        // Test database connection
        await db.query('SELECT NOW()');
        console.log('✅ Database connection established');

        // Run schema
        console.log('📊 Creating database schema...');
        const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
        await db.query(schema);
        console.log('✅ Database schema created');

        // Import existing mock data if available
        try {
            const mockData = require('../utils/mockData');
            
            // Migrate users
            console.log('👥 Migrating users...');
            for (const user of mockData.users) {
                await db.query(`
                    INSERT INTO users (username, email, password_hash, role) 
                    VALUES ($1, $2, $3, $4) 
                    ON CONFLICT (username) DO NOTHING
                `, [user.username, user.email, user.password, user.role]);
            }
            console.log('✅ Users migrated');

            // Migrate cases
            console.log('📁 Migrating cases...');
            for (const case_ of mockData.cases) {
                await db.query(`
                    INSERT INTO cases (id, title, description, status, priority, tags, metadata) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7) 
                    ON CONFLICT (id) DO NOTHING
                `, [case_.id, case_.title, case_.description, case_.status, case_.priority, case_.tags, JSON.stringify(case_.metadata)]);
            }
            console.log('✅ Cases migrated');

            console.log('\n🎉 Migration completed successfully!');
        } catch (error) {
            console.log('ℹ️ No existing mock data found, using default data');
        }

        // Verify migration
        const userCount = await db.query('SELECT COUNT(*) FROM users');
        const caseCount = await db.query('SELECT COUNT(*) FROM cases');
        
        console.log('\n📊 Migration Summary:');
        console.log(`   Users: ${userCount.rows[0].count}`);
        console.log(`   Cases: ${caseCount.rows[0].count}`);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

migrate();
