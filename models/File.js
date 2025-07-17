// models/File.js - Enhanced File model with Video Support and Advanced Queries
const db = require('../config/database');

class File {
  static async create(fileData) {
    const {
      case_id, file_name, original_name, file_key, file_url,
      file_type, file_size, capture_type, uploaded_by,
      description, source_url, video_metadata, session_id,
      upload_method, multipart_upload_id
    } = fileData;

    const result = await db.query(`
      INSERT INTO files (
        case_id, file_name, original_name, file_key, file_url,
        file_type, file_size, capture_type, uploaded_by,
        description, source_url, video_metadata, session_id,
        upload_method, multipart_upload_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      case_id, file_name, original_name, file_key, file_url, 
      file_type, file_size, capture_type, uploaded_by,
      description, source_url, JSON.stringify(video_metadata), session_id,
      upload_method, multipart_upload_id
    ]);

    return result.rows[0];
  }

  static async findById(id) {
    const result = await db.query(`
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.id = $1
    `, [id]);
    
    return result.rows[0];
  }

  static async findByKey(fileKey) {
    const result = await db.query(`
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.file_key = $1
    `, [fileKey]);
    
    return result.rows[0];
  }

  static async findByCaseId(caseId, filters = {}) {
    let query = `
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.case_id = $1 AND f.status = 'completed'
    `;
    const params = [caseId];
    let paramCount = 1;

    // Apply filters
    if (filters.captureType) {
      paramCount++;
      query += ` AND f.capture_type = $${paramCount}`;
      params.push(filters.captureType);
    }

    if (filters.search) {
      paramCount++;
      query += ` AND (
        f.description ILIKE $${paramCount} OR 
        f.source_url ILIKE $${paramCount} OR 
        f.file_name ILIKE $${paramCount} OR
        f.original_name ILIKE $${paramCount}
      )`;
      params.push(`%${filters.search}%`);
    }

    // Video-specific filters
    if (filters.videoDuration && filters.captureType === 'video') {
      const [minDuration, maxDuration] = filters.videoDuration.split(':').map(Number);
      paramCount++;
      query += ` AND (f.video_metadata->>'duration')::numeric BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(minDuration, maxDuration);
      paramCount++;
    }

    if (filters.videoResolution && filters.captureType === 'video') {
      const [width, height] = filters.videoResolution.split('x').map(Number);
      paramCount++;
      query += ` AND (f.video_metadata->>'width')::numeric = $${paramCount} AND (f.video_metadata->>'height')::numeric = $${paramCount + 1}`;
      params.push(width, height);
      paramCount++;
    }

    if (filters.videoCodec && filters.captureType === 'video') {
      paramCount++;
      query += ` AND f.video_metadata->>'codec' = $${paramCount}`;
      params.push(filters.videoCodec);
    }

    if (filters.hasAudio !== undefined && filters.captureType === 'video') {
      paramCount++;
      query += ` AND (f.video_metadata->>'hasAudio')::boolean = $${paramCount}`;
      params.push(filters.hasAudio === 'true');
    }

    // Sorting
    const sortColumn = this.getSortColumn(filters.sortBy);
    const sortDirection = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${sortDirection}`;

    // Pagination
    if (filters.limit) {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit);
      const offset = (page - 1) * limit;
      
      query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  static getSortColumn(sortBy) {
    switch (sortBy) {
      case 'name': return 'f.file_name';
      case 'size': return 'f.file_size';
      case 'duration': return "(f.video_metadata->>'duration')::numeric";
      case 'resolution': return "((f.video_metadata->>'width')::numeric * (f.video_metadata->>'height')::numeric)";
      case 'date':
      default: return 'f.created_at';
    }
  }

  static async confirmUpload(fileId, uploadData) {
    const { actualFileSize, checksum, s3Metadata } = uploadData;
    
    const result = await db.query(`
      UPDATE files 
      SET 
        status = 'completed',
        file_size = COALESCE($2, file_size),
        checksum = $3,
        s3_metadata = $4,
        uploaded_at = NOW(),
        multipart_upload_id = NULL
      WHERE id = $1
      RETURNING *
    `, [fileId, actualFileSize, checksum, JSON.stringify(s3Metadata)]);

    return result.rows[0];
  }

  static async updateMetadata(fileId, metadata) {
    const { description, source_url, video_metadata } = metadata;
    
    let query = 'UPDATE files SET ';
    const updates = [];
    const params = [];
    let paramCount = 0;

    if (description !== undefined) {
      paramCount++;
      updates.push(`description = $${paramCount}`);
      params.push(description);
    }

    if (source_url !== undefined) {
      paramCount++;
      updates.push(`source_url = $${paramCount}`);
      params.push(source_url);
    }

    if (video_metadata !== undefined) {
      paramCount++;
      updates.push(`video_metadata = $${paramCount}`);
      params.push(JSON.stringify(video_metadata));
    }

    if (updates.length === 0) return null;

    paramCount++;
    query += updates.join(', ') + ` WHERE id = ${paramCount} RETURNING *`;
    params.push(fileId);

    const result = await db.query(query, params);
    return result.rows[0];
  }

  static async updateMultipartUploadId(fileId, uploadId) {
    const result = await db.query(`
      UPDATE files SET multipart_upload_id = $1 WHERE id = $2 RETURNING *
    `, [uploadId, fileId]);
    return result.rows[0];
  }

  static async updateStatus(fileId, status) {
    const result = await db.query(`
      UPDATE files SET status = $1 WHERE id = $2 RETURNING *
    `, [status, fileId]);
    return result.rows[0];
  }

  static async updateStorageClass(fileId, storageClass) {
    const result = await db.query(`
      UPDATE files 
      SET s3_metadata = COALESCE(s3_metadata, '{}'::jsonb) || $1
      WHERE id = $2 
      RETURNING *
    `, [JSON.stringify({ storageClass }), fileId]);
    return result.rows[0];
  }

  static async delete(fileKey) {
    const result = await db.query(
      'DELETE FROM files WHERE file_key = $1 RETURNING *',
      [fileKey]
    );
    return result.rows[0];
  }

  static async searchFiles(searchQuery, filters = {}) {
    let query = `
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.status = 'completed'
        AND (
          f.description ILIKE $1 
          OR f.source_url ILIKE $1 
          OR f.file_name ILIKE $1
          OR f.original_name ILIKE $1
        )
    `;
    const params = [`%${searchQuery}%`];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND f.case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND f.capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    // Video-specific filters
    if (filters.videoDuration && filters.captureType === 'video') {
      const [minDuration, maxDuration] = filters.videoDuration.split(':').map(Number);
      paramCount++;
      query += ` AND (f.video_metadata->>'duration')::numeric BETWEEN ${paramCount} AND ${paramCount + 1}`;
      params.push(minDuration, maxDuration);
      paramCount++;
    }

    if (filters.videoResolution && filters.captureType === 'video') {
      const [width, height] = filters.videoResolution.split('x').map(Number);
      paramCount++;
      query += ` AND (f.video_metadata->>'width')::numeric = ${paramCount} AND (f.video_metadata->>'height')::numeric = ${paramCount + 1}`;
      params.push(width, height);
      paramCount++;
    }

    if (filters.videoCodec && filters.captureType === 'video') {
      paramCount++;
      query += ` AND f.video_metadata->>'codec' = ${paramCount}`;
      params.push(filters.videoCodec);
    }

    if (filters.hasAudio !== undefined && filters.captureType === 'video') {
      paramCount++;
      query += ` AND (f.video_metadata->>'hasAudio')::boolean = ${paramCount}`;
      params.push(filters.hasAudio === 'true');
    }

    query += ` ORDER BY f.created_at DESC`;

    // Pagination
    if (filters.limit) {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit);
      const offset = (page - 1) * limit;
      
      query += ` LIMIT ${paramCount + 1} OFFSET ${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getFilesBySourceUrl(sourceUrl, filters = {}) {
    let query = `
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.status = 'completed' AND f.source_url ILIKE $1
    `;
    const params = [`%${sourceUrl}%`];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND f.case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND f.capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    query += ` ORDER BY f.created_at DESC`;

    // Pagination
    if (filters.limit) {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit);
      const offset = (page - 1) * limit;
      
      query += ` LIMIT ${paramCount + 1} OFFSET ${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getFilesBySession(sessionId, filters = {}) {
    let query = `
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.status = 'completed' AND f.session_id = $1
    `;
    const params = [sessionId];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND f.case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    // Sorting
    const sortColumn = this.getSortColumn(filters.sortBy);
    const sortDirection = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${sortDirection}`;

    // Pagination
    if (filters.limit) {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit);
      const offset = (page - 1) * limit;
      
      query += ` LIMIT ${paramCount + 1} OFFSET ${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getStats(filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total_files,
        COALESCE(SUM(file_size), 0) as total_size,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') as files_with_description,
        COUNT(*) FILTER (WHERE source_url IS NOT NULL AND source_url != '') as files_with_source_url,
        AVG(file_size) as average_file_size,
        MAX(file_size) as max_file_size,
        MIN(file_size) as min_file_size
      FROM files 
      WHERE status = 'completed'
    `;
    const params = [];
    let paramCount = 0;

    if (filters.caseId) {
      paramCount++;
      query += ` AND case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.userId) {
      paramCount++;
      query += ` AND uploaded_by = ${paramCount}`;
      params.push(filters.userId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    if (filters.days) {
      paramCount++;
      query += ` AND created_at >= NOW() - INTERVAL '${filters.days} days'`;
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }

  static async getDetailedStats(filters = {}) {
    // Get upload distribution by day
    let timeQuery = `
      SELECT 
        DATE(created_at) as upload_date,
        COUNT(*) as files_count,
        SUM(file_size) as total_size
      FROM files 
      WHERE status = 'completed'
    `;
    const timeParams = [];
    let paramCount = 0;

    if (filters.caseId) {
      paramCount++;
      timeQuery += ` AND case_id = ${paramCount}`;
      timeParams.push(filters.caseId);
    }

    if (filters.days) {
      paramCount++;
      timeQuery += ` AND created_at >= NOW() - INTERVAL '${filters.days} days'`;
    }

    timeQuery += ` GROUP BY DATE(created_at) ORDER BY upload_date DESC LIMIT 30`;

    const timeResult = await db.query(timeQuery, timeParams);

    // Get top source URLs
    let urlQuery = `
      SELECT 
        source_url,
        COUNT(*) as file_count
      FROM files 
      WHERE status = 'completed' AND source_url IS NOT NULL AND source_url != ''
    `;

    if (filters.caseId) {
      urlQuery += ` AND case_id = $1`;
    }

    urlQuery += ` GROUP BY source_url ORDER BY file_count DESC LIMIT 10`;

    const urlResult = await db.query(urlQuery, filters.caseId ? [filters.caseId] : []);

    // Get file type distribution
    let typeQuery = `
      SELECT 
        file_type,
        COUNT(*) as count,
        SUM(file_size) as total_size
      FROM files 
      WHERE status = 'completed'
    `;

    if (filters.caseId) {
      typeQuery += ` AND case_id = $1`;
    }

    typeQuery += ` GROUP BY file_type ORDER BY count DESC`;

    const typeResult = await db.query(typeQuery, filters.caseId ? [filters.caseId] : []);

    return {
      uploadsByDay: timeResult.rows,
      topSourceUrls: urlResult.rows,
      fileTypeDistribution: typeResult.rows
    };
  }

  static async getVideoStats(filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total_videos,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COALESCE(AVG((video_metadata->>'duration')::numeric), 0) as average_duration,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(AVG(file_size), 0) as average_size,
        COUNT(*) FILTER (WHERE (video_metadata->>'hasAudio')::boolean = true) as videos_with_audio,
        COUNT(*) FILTER (WHERE upload_method = 'MULTIPART') as multipart_uploads
      FROM files 
      WHERE status = 'completed' AND capture_type = 'video'
    `;
    const params = [];
    let paramCount = 0;

    if (filters.caseId) {
      paramCount++;
      query += ` AND case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.days) {
      paramCount++;
      query += ` AND created_at >= NOW() - INTERVAL '${filters.days} days'`;
    }

    const result = await db.query(query, params);

    // Get resolution distribution
    let resQuery = `
      SELECT 
        CONCAT((video_metadata->>'width'), 'x', (video_metadata->>'height')) as resolution,
        COUNT(*) as count
      FROM files 
      WHERE status = 'completed' AND capture_type = 'video' 
        AND video_metadata->>'width' IS NOT NULL 
        AND video_metadata->>'height' IS NOT NULL
    `;

    if (filters.caseId) {
      resQuery += ` AND case_id = $1`;
    }

    resQuery += ` GROUP BY resolution ORDER BY count DESC LIMIT 10`;

    const resResult = await db.query(resQuery, filters.caseId ? [filters.caseId] : []);

    // Get codec distribution
    let codecQuery = `
      SELECT 
        video_metadata->>'codec' as codec,
        COUNT(*) as count
      FROM files 
      WHERE status = 'completed' AND capture_type = 'video' 
        AND video_metadata->>'codec' IS NOT NULL
    `;

    if (filters.caseId) {
      codecQuery += ` AND case_id = $1`;
    }

    codecQuery += ` GROUP BY codec ORDER BY count DESC`;

    const codecResult = await db.query(codecQuery, filters.caseId ? [filters.caseId] : []);

    return {
      ...result.rows[0],
      resolutionBreakdown: resResult.rows,
      codecBreakdown: codecResult.rows
    };
  }

  static async getCaseFilesSummary(caseId, filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') as files_with_description,
        COUNT(*) FILTER (WHERE source_url IS NOT NULL AND source_url != '') as files_with_source_url,
        COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) as unique_sessions
      FROM files 
      WHERE case_id = $1 AND status = 'completed'
    `;
    const params = [caseId];
    let paramCount = 1;

    if (filters.captureType) {
      paramCount++;
      query += ` AND capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    if (filters.search) {
      paramCount++;
      query += ` AND (
        description ILIKE ${paramCount} OR 
        source_url ILIKE ${paramCount} OR 
        file_name ILIKE ${paramCount}
      )`;
      params.push(`%${filters.search}%`);
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }

  static async getSearchSummary(searchQuery, filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COUNT(DISTINCT case_id) as unique_cases,
        COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) as unique_sessions
      FROM files 
      WHERE status = 'completed'
        AND (
          description ILIKE $1 
          OR source_url ILIKE $1 
          OR file_name ILIKE $1
          OR original_name ILIKE $1
        )
    `;
    const params = [`%${searchQuery}%`];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }

  static async getSourceUrlSummary(sourceUrl, filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COUNT(DISTINCT case_id) as unique_cases,
        COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) as unique_sessions
      FROM files 
      WHERE status = 'completed' AND source_url ILIKE $1
    `;
    const params = [`%${sourceUrl}%`];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND capture_type = ${paramCount}`;
      params.push(filters.captureType);
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }

  static async getSessionSummary(sessionId, filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COUNT(DISTINCT case_id) as unique_cases,
        MIN(created_at) as session_start,
        MAX(COALESCE(uploaded_at, created_at)) as session_end
      FROM files 
      WHERE status = 'completed' AND session_id = $1
    `;
    const params = [sessionId];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND case_id = ${paramCount}`;
      params.push(filters.caseId);
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }
}

module.exports = File;