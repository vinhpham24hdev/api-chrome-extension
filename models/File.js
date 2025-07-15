// models/File.js - File model with PostgreSQL - UPDATED with description and source_url
const db = require('../config/database');

class File {
  static async create(fileData) {
    const {
      case_id, file_name, original_name, file_key, file_url,
      file_type, file_size, capture_type, uploaded_by,
      description, source_url // ✅ NEW: Add description and source_url
    } = fileData;

    const result = await db.query(`
      INSERT INTO files (
        case_id, file_name, original_name, file_key, file_url,
        file_type, file_size, capture_type, uploaded_by,
        description, source_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      case_id, file_name, original_name, file_key, file_url, 
      file_type, file_size, capture_type, uploaded_by,
      description, source_url
    ]);

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

    if (filters.captureType) {
      paramCount++;
      query += ` AND f.capture_type = $${paramCount}`;
      params.push(filters.captureType);
    }

    // ✅ NEW: Add search by description or source_url
    if (filters.search) {
      paramCount++;
      query += ` AND (f.description ILIKE $${paramCount} OR f.source_url ILIKE $${paramCount} OR f.file_name ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
    }

    query += ` ORDER BY f.created_at DESC`;

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

  static async findByKey(fileKey) {
    const result = await db.query(
      'SELECT * FROM files WHERE file_key = $1',
      [fileKey]
    );
    return result.rows[0];
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
        uploaded_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [fileId, actualFileSize, checksum, JSON.stringify(s3Metadata)]);

    return result.rows[0];
  }

  // ✅ NEW: Update description and source_url
  static async updateMetadata(fileId, metadata) {
    const { description, source_url } = metadata;
    
    const result = await db.query(`
      UPDATE files 
      SET 
        description = COALESCE($2, description),
        source_url = COALESCE($3, source_url)
      WHERE id = $1
      RETURNING *
    `, [fileId, description, source_url]);

    return result.rows[0];
  }

  static async delete(fileKey) {
    const result = await db.query(
      'DELETE FROM files WHERE file_key = $1 RETURNING *',
      [fileKey]
    );
    return result.rows[0];
  }

  static async getStats(filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total_files,
        COALESCE(SUM(file_size), 0) as total_size,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COUNT(*) FILTER (WHERE description IS NOT NULL) as files_with_description,
        COUNT(*) FILTER (WHERE source_url IS NOT NULL) as files_with_source_url
      FROM files 
      WHERE status = 'completed'
    `;
    const params = [];

    if (filters.caseId) {
      query += ' AND case_id = $1';
      params.push(filters.caseId);
    }

    if (filters.days) {
      const paramNum = params.length + 1;
      query += ` AND created_at >= NOW() - INTERVAL '${filters.days} days'`;
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }

  // ✅ NEW: Search files by description or source URL
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
      query += ` AND f.case_id = $${paramCount}`;
      params.push(filters.caseId);
    }

    if (filters.captureType) {
      paramCount++;
      query += ` AND f.capture_type = $${paramCount}`;
      params.push(filters.captureType);
    }

    query += ` ORDER BY f.created_at DESC`;

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

  // ✅ NEW: Get files by source URL (useful for finding all captures from same website)
  static async getFilesBySourceUrl(sourceUrl, filters = {}) {
    let query = `
      SELECT f.*, u.username as uploaded_by_username
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.status = 'completed' AND f.source_url = $1
    `;
    const params = [sourceUrl];
    let paramCount = 1;

    if (filters.caseId) {
      paramCount++;
      query += ` AND f.case_id = $${paramCount}`;
      params.push(filters.caseId);
    }

    query += ` ORDER BY f.created_at DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }
}

module.exports = File;