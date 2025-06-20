// models/File.js - File model with PostgreSQL
const db = require('../config/database');

class File {
  static async create(fileData) {
    const {
      case_id, file_name, original_name, file_key, file_url,
      file_type, file_size, capture_type, uploaded_by
    } = fileData;

    const result = await db.query(`
      INSERT INTO files (
        case_id, file_name, original_name, file_key, file_url,
        file_type, file_size, capture_type, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [case_id, file_name, original_name, file_key, file_url, file_type, file_size, capture_type, uploaded_by]);

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
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos
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
}

module.exports = File;
