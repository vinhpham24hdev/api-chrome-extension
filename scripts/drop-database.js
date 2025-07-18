#!/usr/bin/env node

// scripts/drop-database.js - Drop all tables and reset database
const db = require('../config/database');

async function dropDatabase() {
    console.log('🗑️ Dropping all database tables and objects...\n');

    try {
        // Test database connection
        await db.query('SELECT NOW()');
        console.log('✅ Database connection established');

        // Get all tables
        const tablesResult = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        const tables = tablesResult.rows.map(row => row.table_name);
        console.log('📋 Found tables:', tables);

        if (tables.length === 0) {
            console.log('ℹ️ No tables found to drop');
            return;
        }

        // Drop all tables in correct order (reverse dependency order)
        console.log('🗑️ Dropping tables...');
        
        // Drop tables that depend on others first
        const dropOrder = [
            'audit_logs',
            'sessions', 
            'files',
            'cases',
            'users'
        ];

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

        console.log('✅ All tables dropped');

        // Drop functions
        console.log('🗑️ Dropping functions...');
        await db.query('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
        console.log('✅ Functions dropped');

        // Get remaining functions
        const functionsResult = await db.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_type = 'FUNCTION'
        `);
        
        if (functionsResult.rows.length > 0) {
            console.log('📋 Remaining functions:', functionsResult.rows.map(r => r.routine_name));
        }

        // Drop types if any
        console.log('🗑️ Dropping custom types...');
        const typesResult = await db.query(`
            SELECT typname 
            FROM pg_type 
            WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            AND typtype = 'e'
        `);
        
        for (const type of typesResult.rows) {
            console.log(`   Dropping type ${type.typname}...`);
            await db.query(`DROP TYPE IF EXISTS ${type.typname} CASCADE`);
        }

        // Optionally drop extensions (uncomment if needed)
        // console.log('🗑️ Dropping extensions...');
        // await db.query('DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE');
        // await db.query('DROP EXTENSION IF EXISTS "pgcrypto" CASCADE');
        // console.log('✅ Extensions dropped');

        // Verify cleanup
        const finalTablesResult = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
        `);

        const finalTables = finalTablesResult.rows.map(row => row.table_name);
        
        if (finalTables.length === 0) {
            console.log('\n🎉 Database successfully cleaned! No tables remaining.');
        } else {
            console.log('\n⚠️ Some tables still exist:', finalTables);
        }

        console.log('\n✅ Database drop completed successfully!');
        console.log('💡 You can now run the migration script to recreate the database.');

    } catch (error) {
        console.error('❌ Drop operation failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        // Try different ways to close the connection
        try {
            if (db.end) {
                await db.end();
            } else if (db.close) {
                await db.close();
            } else if (db.destroy) {
                await db.destroy();
            }
        } catch (closeError) {
            console.log('ℹ️ Connection cleanup not needed or failed:', closeError.message);
        }
        process.exit(0);
    }
}

// Confirm before dropping
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('⚠️  Are you sure you want to drop ALL database tables? This cannot be undone! (yes/no): ', (answer) => {
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        rl.close();
        dropDatabase();
    } else {
        console.log('❌ Operation cancelled');
        rl.close();
        process.exit(0);
    }
});