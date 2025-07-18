-- database/schema.sql - PostgreSQL Schema with Description and Source URL
-- Create database schema for Screen Capture Tool

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

-- Cases table
CREATE TABLE IF NOT EXISTS cases (
    id VARCHAR(20) PRIMARY KEY, -- CASE-001 format
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'closed', 'archived')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tags TEXT[], -- Array of tags
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Files table - UPDATED with description and source_url
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id VARCHAR(20) REFERENCES cases(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_key VARCHAR(500) NOT NULL UNIQUE, -- S3 key
    file_url VARCHAR(1000) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    capture_type VARCHAR(20) CHECK (capture_type IN ('screenshot', 'video')),
    description TEXT, -- Description of the screenshot/video
    source_url TEXT, -- URL of the page that was captured
    uploaded_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    checksum VARCHAR(64),
    s3_metadata JSONB DEFAULT '{}'::jsonb,
    video_metadata JSONB DEFAULT '{}'::jsonb, -- Video-specific metadata
    session_id VARCHAR(255), -- Session ID for grouping related recordings
    upload_method VARCHAR(20) DEFAULT 'PUT' CHECK (upload_method IN ('PUT', 'POST', 'MULTIPART')),
    multipart_upload_id VARCHAR(255), -- For multipart uploads
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_at TIMESTAMP WITH TIME ZONE
);

-- Sessions table (for JWT blacklisting)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_to ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at);
CREATE INDEX IF NOT EXISTS idx_files_case_id ON files(case_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
CREATE INDEX IF NOT EXISTS idx_files_source_url ON files(source_url);
CREATE INDEX IF NOT EXISTS idx_files_description ON files(description) WHERE description IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Functions and triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON cases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, role) 
VALUES (
    'admin', 
    'admin@screencapture.com', 
    '$2b$10$8K7QQg0kRlZlQZ8QJGz1ZeHfZQn0n3Q8n0n3Q8n0n3Q8n0n3Q8n0',
    'admin'
) ON CONFLICT (username) DO NOTHING;

-- Insert demo user (password: password)
INSERT INTO users (username, email, password_hash, role) 
VALUES (
    'demo', 
    'demo@screencapture.com', 
    '$2b$10$K7QQg0kRlZlQZ8QJGz1ZeHfZQn0n3Q8n0n3Q8n0n3Q8n0n3Q8n0',
    'user'
) ON CONFLICT (username) DO NOTHING;

-- Insert sample cases
INSERT INTO cases (id, title, description, priority, assigned_to, created_by) 
SELECT 
    'CASE-001',
    'Website Bug Investigation', 
    'Critical layout issues on homepage affecting user experience',
    'high',
    u1.id,
    u2.id
FROM users u1, users u2 
WHERE u1.username = 'demo' AND u2.username = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases (id, title, description, priority, assigned_to, created_by) 
SELECT 
    'CASE-002',
    'Performance Issue Analysis', 
    'Page loading times significantly slower than expected',
    'medium',
    u1.id,
    u2.id
FROM users u1, users u2 
WHERE u1.username = 'demo' AND u2.username = 'admin'
ON CONFLICT (id) DO NOTHING;