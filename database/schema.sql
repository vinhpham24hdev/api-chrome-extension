-- database/schema.sql - Updated PostgreSQL Schema with Video Support
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

-- Enhanced Files table with video support
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id VARCHAR(20) REFERENCES cases(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_key VARCHAR(500) NOT NULL UNIQUE, -- S3 key
    file_url VARCHAR(1000) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    capture_type VARCHAR(20) CHECK (capture_type IN ('screenshot', 'video')),
    description TEXT, -- Description of the screenshot/video
    source_url TEXT, -- URL of the page that was captured
    uploaded_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    checksum VARCHAR(64),
    s3_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_at TIMESTAMP WITH TIME ZONE,
    
    -- ✅ NEW: Video-specific fields
    video_metadata JSONB DEFAULT NULL, -- Video duration, resolution, codec, etc.
    session_id VARCHAR(100), -- For grouping related recordings
    upload_method VARCHAR(20) DEFAULT 'PUT' CHECK (upload_method IN ('PUT', 'POST', 'MULTIPART')),
    multipart_upload_id VARCHAR(100), -- For ongoing multipart uploads
    processing_status VARCHAR(20) DEFAULT NULL CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- ✅ NEW: Enhanced metadata
    storage_class VARCHAR(20) DEFAULT 'STANDARD',
    thumbnail_url TEXT, -- For video thumbnails
    compressed_versions JSONB DEFAULT '[]'::jsonb -- Array of compressed versions
);

-- Sessions table (for JWT blacklisting and user sessions)
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

-- ✅ NEW: Video processing jobs table
CREATE TABLE IF NOT EXISTS video_processing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('thumbnail', 'compress', 'transcode', 'analyze')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    input_params JSONB DEFAULT '{}'::jsonb,
    output_data JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced indexes for performance
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_to ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at);
CREATE INDEX IF NOT EXISTS idx_cases_updated_at ON cases(updated_at);

-- File indexes
CREATE INDEX IF NOT EXISTS idx_files_case_id ON files(case_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_capture_type ON files(capture_type);
CREATE INDEX IF NOT EXISTS idx_files_source_url ON files(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_description ON files(description) WHERE description IS NOT NULL;

-- ✅ NEW: Video-specific indexes
CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_upload_method ON files(upload_method);
CREATE INDEX IF NOT EXISTS idx_files_multipart_upload_id ON files(multipart_upload_id) WHERE multipart_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_processing_status ON files(processing_status) WHERE processing_status IS NOT NULL;

-- JSON indexes for video metadata
CREATE INDEX IF NOT EXISTS idx_files_video_duration ON files((video_metadata->>'duration')::numeric) WHERE capture_type = 'video';
CREATE INDEX IF NOT EXISTS idx_files_video_resolution ON files((video_metadata->>'width')::numeric, (video_metadata->>'height')::numeric) WHERE capture_type = 'video';
CREATE INDEX IF NOT EXISTS idx_files_video_codec ON files((video_metadata->>'codec')) WHERE capture_type = 'video';
CREATE INDEX IF NOT EXISTS idx_files_video_has_audio ON files((video_metadata->>'hasAudio')::boolean) WHERE capture_type = 'video';

-- Other indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_file_id ON video_processing_jobs(file_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_processing_jobs(status);

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

-- ✅ ENHANCED: Function to automatically update case metadata when files change
CREATE OR REPLACE FUNCTION update_case_metadata_on_file_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Update case metadata when file is inserted, updated, or deleted
    IF TG_OP = 'INSERT' AND NEW.status = 'completed' THEN
        UPDATE cases 
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'totalFiles', COALESCE((metadata->>'totalFiles')::int, 0) + 1,
            'totalFileSize', COALESCE((metadata->>'totalFileSize')::bigint, 0) + NEW.file_size,
            'totalScreenshots', CASE WHEN NEW.capture_type = 'screenshot' 
                THEN COALESCE((metadata->>'totalScreenshots')::int, 0) + 1 
                ELSE COALESCE((metadata->>'totalScreenshots')::int, 0) END,
            'totalVideos', CASE WHEN NEW.capture_type = 'video' 
                THEN COALESCE((metadata->>'totalVideos')::int, 0) + 1 
                ELSE COALESCE((metadata->>'totalVideos')::int, 0) END,
            'lastActivity', NOW()::text
        ),
        updated_at = NOW()
        WHERE id = NEW.case_id;
    END IF;
    
    IF TG_OP = 'DELETE' AND OLD.status = 'completed' THEN
        UPDATE cases 
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'totalFiles', GREATEST(0, COALESCE((metadata->>'totalFiles')::int, 0) - 1),
            'totalFileSize', GREATEST(0, COALESCE((metadata->>'totalFileSize')::bigint, 0) - OLD.file_size),
            'totalScreenshots', CASE WHEN OLD.capture_type = 'screenshot' 
                THEN GREATEST(0, COALESCE((metadata->>'totalScreenshots')::int, 0) - 1)
                ELSE COALESCE((metadata->>'totalScreenshots')::int, 0) END,
            'totalVideos', CASE WHEN OLD.capture_type = 'video' 
                THEN GREATEST(0, COALESCE((metadata->>'totalVideos')::int, 0) - 1)
                ELSE COALESCE((metadata->>'totalVideos')::int, 0) END,
            'lastActivity', NOW()::text
        ),
        updated_at = NOW()
        WHERE id = OLD.case_id;
    END IF;
    
    IF TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed' THEN
        -- File was just confirmed as completed
        UPDATE cases 
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'totalFiles', COALESCE((metadata->>'totalFiles')::int, 0) + 1,
            'totalFileSize', COALESCE((metadata->>'totalFileSize')::bigint, 0) + NEW.file_size,
            'totalScreenshots', CASE WHEN NEW.capture_type = 'screenshot' 
                THEN COALESCE((metadata->>'totalScreenshots')::int, 0) + 1 
                ELSE COALESCE((metadata->>'totalScreenshots')::int, 0) END,
            'totalVideos', CASE WHEN NEW.capture_type = 'video' 
                THEN COALESCE((metadata->>'totalVideos')::int, 0) + 1 
                ELSE COALESCE((metadata->>'totalVideos')::int, 0) END,
            'lastActivity', NOW()::text
        ),
        updated_at = NOW()
        WHERE id = NEW.case_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER update_case_metadata_trigger
    AFTER INSERT OR UPDATE OR DELETE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_case_metadata_on_file_change();

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

-- Insert sample cases with proper user references
INSERT INTO cases (id, title, description, priority, assigned_to, created_by, metadata) 
SELECT 
    'CASE-001',
    'Website Bug Investigation', 
    'Critical layout issues on homepage affecting user experience',
    'high',
    u1.id,
    u2.id,
    '{"totalFiles": 0, "totalScreenshots": 0, "totalVideos": 0, "totalFileSize": 0, "lastActivity": "2024-01-01T00:00:00Z"}'::jsonb
FROM users u1, users u2 
WHERE u1.username = 'demo' AND u2.username = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases (id, title, description, priority, assigned_to, created_by, metadata) 
SELECT 
    'CASE-002',
    'Performance Issue Analysis', 
    'Page loading times significantly slower than expected',
    'medium',
    u1.id,
    u2.id,
    '{"totalFiles": 0, "totalScreenshots": 0, "totalVideos": 0, "totalFileSize": 0, "lastActivity": "2024-01-01T00:00:00Z"}'::jsonb
FROM users u1, users u2 
WHERE u1.username = 'demo' AND u2.username = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases (id, title, description, priority, assigned_to, created_by, metadata) 
SELECT 
    'CASE-003',
    'Video Recording Test Case', 
    'Testing video upload and processing capabilities',
    'low',
    u1.id,
    u2.id,
    '{"totalFiles": 0, "totalScreenshots": 0, "totalVideos": 0, "totalFileSize": 0, "lastActivity": "2024-01-01T00:00:00Z"}'::jsonb
FROM users u1, users u2 
WHERE u1.username = 'demo' AND u2.username = 'admin'
ON CONFLICT (id) DO NOTHING;

-- ✅ NEW: Create views for common queries
CREATE OR REPLACE VIEW case_summary AS
SELECT 
    c.*,
    u.username as assigned_to_username,
    cu.username as created_by_username,
    COALESCE(f.file_count, 0) as file_count,
    COALESCE(f.total_size, 0) as total_file_size,
    COALESCE(f.screenshot_count, 0) as screenshot_count,
    COALESCE(f.video_count, 0) as video_count,
    COALESCE(f.total_duration, 0) as total_video_duration,
    f.last_upload
FROM cases c
LEFT JOIN users u ON c.assigned_to = u.id
LEFT JOIN users cu ON c.created_by = cu.id
LEFT JOIN (
    SELECT 
        case_id,
        COUNT(*) as file_count,
        SUM(file_size) as total_size,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshot_count,
        COUNT(*) FILTER (WHERE capture_type = 'video') as video_count,
        SUM((video_metadata->>'duration')::numeric) as total_duration,
        MAX(COALESCE(uploaded_at, created_at)) as last_upload
    FROM files 
    WHERE status = 'completed'
    GROUP BY case_id
) f ON c.id = f.case_id;

CREATE OR REPLACE VIEW video_stats AS
SELECT 
    f.*,
    u.username as uploaded_by_username,
    c.title as case_title,
    (f.video_metadata->>'duration')::numeric as duration_seconds,
    (f.video_metadata->>'width')::int as video_width,
    (f.video_metadata->>'height')::int as video_height,
    f.video_metadata->>'codec' as video_codec,
    (f.video_metadata->>'bitrate')::bigint as video_bitrate,
    (f.video_metadata->>'fps')::numeric as video_fps,
    (f.video_metadata->>'hasAudio')::boolean as has_audio
FROM files f
LEFT JOIN users u ON f.uploaded_by = u.id
LEFT JOIN cases c ON f.case_id = c.id
WHERE f.capture_type = 'video' AND f.status = 'completed';

-- Add helpful comments
COMMENT ON TABLE files IS 'Enhanced files table with video support and metadata';
COMMENT ON COLUMN files.video_metadata IS 'JSON metadata for video files including duration, resolution, codec, etc.';
COMMENT ON COLUMN files.session_id IS 'Groups related recordings from the same capture session';
COMMENT ON COLUMN files.upload_method IS 'Method used for upload: PUT (simple), POST (form), MULTIPART (large files)';
COMMENT ON COLUMN files.multipart_upload_id IS 'S3 multipart upload ID for ongoing uploads';
COMMENT ON COLUMN files.processing_status IS 'Status of video processing (thumbnail generation, compression, etc.)';

COMMENT ON VIEW case_summary IS 'Comprehensive view of cases with file statistics';
COMMENT ON VIEW video_stats IS 'Detailed view of video files with metadata extracted';

-- Final success message
DO $$
BEGIN
    RAISE NOTICE 'Database schema created successfully with video support!';
    RAISE NOTICE 'Features include:';
    RAISE NOTICE '- Enhanced file table with video metadata';
    RAISE NOTICE '- Automatic case metadata updates via triggers';
    RAISE NOTICE '- Video processing job tracking';
    RAISE NOTICE '- Optimized indexes for video queries';
    RAISE NOTICE '- Helpful views for common operations';
END $$;