// models/Case.js - Enhanced Case model with Advanced Queries
const db = require('../config/database');

class Case {
  static async findAll(filters = {}) {
    let query = `
      SELECT c.*, u.username as assigned_to_username, cu.username as created_by_username
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users cu ON c.created_by = cu.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      paramCount++;
      query += ` AND c.status = ANY($${paramCount})`;
      params.push(filters.status);
    }

    if (filters.priority && filters.priority.length > 0) {
      paramCount++;
      query += ` AND c.priority = ANY($${paramCount})`;
      params.push(filters.priority);
    }

    if (filters.assignedTo) {
      paramCount++;
      query += ` AND u.username = $${paramCount}`;
      params.push(filters.assignedTo);
    }

    if (filters.search) {
      paramCount++;
      query += ` AND (c.title ILIKE $${paramCount} OR c.description ILIKE $${paramCount} OR c.id ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
    }

    if (filters.tags && filters.tags.length > 0) {
      paramCount++;
      query += ` AND c.tags && $${paramCount}`;
      params.push(filters.tags);
    }

    // Count total for pagination
    const countQuery = query.replace(
      'SELECT c.*, u.username as assigned_to_username, cu.username as created_by_username',
      'SELECT COUNT(*)'
    );
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add ordering
    query += ` ORDER BY c.created_at DESC`;

    // Pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;

    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    
    return {
      cases: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: (page * limit) < total,
        hasPrev: page > 1
      }
    };
  }

  static async findById(id) {
    const result = await db.query(`
      SELECT c.*, u.username as assigned_to_username, cu.username as created_by_username
      FROM cases c 
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users cu ON c.created_by = cu.id
      WHERE c.id = $1
    `, [id]);
    return result.rows[0];
  }

  static async create(caseData, createdBy) {
    const { title, description, priority = 'medium', tags = [] } = caseData;
    
    // Generate case ID
    const countResult = await db.query('SELECT COUNT(*) FROM cases');
    const count = parseInt(countResult.rows[0].count) + 1;
    const id = `CASE-${String(count).padStart(3, '0')}`;

    const result = await db.query(`
      INSERT INTO cases (id, title, description, priority, created_by, tags, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, title, description, priority, createdBy, tags, JSON.stringify({
      totalScreenshots: 0,
      totalVideos: 0,
      totalFileSize: 0,
      lastActivity: new Date().toISOString()
    })]);

    return result.rows[0];
  }

  static async update(id, updates) {
    const fields = [];
    const values = [];
    let paramCount = 0;

    const allowedFields = ['title', 'description', 'status', 'priority', 'assigned_to', 'tags'];
    
    Object.entries(updates).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        paramCount++;
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
      }
    });

    if (fields.length === 0) return null;

    paramCount++;
    values.push(id);

    const query = `
      UPDATE cases 
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  static async delete(id) {
    const result = await db.query('DELETE FROM cases WHERE id = $1 RETURNING id', [id]);
    return result.rows.length > 0;
  }

  static async getStats() {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'closed') as closed,
        COUNT(*) FILTER (WHERE status = 'archived') as archived,
        COUNT(*) FILTER (WHERE priority = 'low') as low_priority,
        COUNT(*) FILTER (WHERE priority = 'medium') as medium_priority,
        COUNT(*) FILTER (WHERE priority = 'high') as high_priority,
        COUNT(*) FILTER (WHERE priority = 'critical') as critical_priority
      FROM cases
    `);
    
    return result.rows[0];
  }

  static async updateMetadata(id, metadata) {
    // Get current metadata
    const currentResult = await db.query('SELECT metadata FROM cases WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) return null;

    const currentMetadata = currentResult.rows[0].metadata || {};
    
    // Merge metadata intelligently
    const updatedMetadata = { ...currentMetadata };
    
    if (metadata.totalScreenshots !== undefined) {
      updatedMetadata.totalScreenshots = Math.max(0, 
        (currentMetadata.totalScreenshots || 0) + metadata.totalScreenshots
      );
    }
    
    if (metadata.totalVideos !== undefined) {
      updatedMetadata.totalVideos = Math.max(0, 
        (currentMetadata.totalVideos || 0) + metadata.totalVideos
      );
    }
    
    if (metadata.totalFileSize !== undefined) {
      updatedMetadata.totalFileSize = Math.max(0, 
        (currentMetadata.totalFileSize || 0) + metadata.totalFileSize
      );
    }
    
    if (metadata.lastActivity) {
      updatedMetadata.lastActivity = metadata.lastActivity;
    }

    const result = await db.query(`
      UPDATE cases 
      SET metadata = $1, updated_at = NOW() 
      WHERE id = $2 
      RETURNING *
    `, [JSON.stringify(updatedMetadata), id]);
    
    return result.rows[0];
  }

  static async getAvailableTags() {
    const result = await db.query(`
      SELECT DISTINCT UNNEST(tags) as tag 
      FROM cases 
      WHERE tags IS NOT NULL 
      ORDER BY tag
    `);
    
    return result.rows.map(row => row.tag);
  }

  static async bulkUpdate(caseIds, updates) {
    const results = {
      updated: 0,
      cases: [],
      errors: []
    };

    for (const caseId of caseIds) {
      try {
        const updatedCase = await this.update(caseId, updates);
        if (updatedCase) {
          results.updated++;
          results.cases.push(updatedCase);
        } else {
          results.errors.push({ caseId, error: "Case not found" });
        }
      } catch (error) {
        results.errors.push({ caseId, error: error.message });
      }
    }

    return results;
  }

  static async getRecentActivity(limit = 10) {
    const result = await db.query(`
      SELECT c.id, c.title, c.status, c.updated_at, c.metadata,
             u.username as assigned_to_username
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.metadata->>'lastActivity' IS NOT NULL
      ORDER BY (c.metadata->>'lastActivity')::timestamp DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status,
      assignedTo: row.assigned_to_username,
      lastActivity: row.metadata?.lastActivity,
      updatedAt: row.updated_at
    }));
  }

  static async getCasesByUser(userId, status = null) {
    let query = `
      SELECT c.*, u.username as assigned_to_username
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.assigned_to = $1
    `;
    const params = [userId];

    if (status) {
      query += ` AND c.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY c.updated_at DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getCaseFileStats(caseId) {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_files,
        COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
        COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(SUM((video_metadata->>'duration')::numeric), 0) as total_duration,
        COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') as files_with_description,
        COUNT(*) FILTER (WHERE source_url IS NOT NULL AND source_url != '') as files_with_source_url,
        COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL) as unique_sessions,
        MIN(created_at) as first_upload,
        MAX(COALESCE(uploaded_at, created_at)) as last_upload
      FROM files 
      WHERE case_id = $1 AND status = 'completed'
    `, [caseId]);

    return result.rows[0];
  }

  static async searchCases(searchQuery, filters = {}) {
    let query = `
      SELECT c.*, u.username as assigned_to_username, cu.username as created_by_username
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users cu ON c.created_by = cu.id
      WHERE (
        c.title ILIKE $1 
        OR c.description ILIKE $1 
        OR c.id ILIKE $1
        OR EXISTS (
          SELECT 1 FROM UNNEST(c.tags) as tag 
          WHERE tag ILIKE $1
        )
      )
    `;
    const params = [`%${searchQuery}%`];
    let paramCount = 1;

    if (filters.status) {
      paramCount++;
      query += ` AND c.status = ${paramCount}`;
      params.push(filters.status);
    }

    if (filters.priority) {
      paramCount++;
      query += ` AND c.priority = ${paramCount}`;
      params.push(filters.priority);
    }

    if (filters.assignedTo) {
      paramCount++;
      query += ` AND u.username = ${paramCount}`;
      params.push(filters.assignedTo);
    }

    query += ` ORDER BY c.updated_at DESC`;

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

  static async getDashboardStats() {
    const [caseStats, fileStats, recentActivity] = await Promise.all([
      this.getStats(),
      db.query(`
        SELECT 
          COUNT(*) as total_files,
          COALESCE(SUM(file_size), 0) as total_size,
          COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
          COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as files_this_week
        FROM files 
        WHERE status = 'completed'
      `),
      this.getRecentActivity(5)
    ]);

    return {
      cases: caseStats,
      files: fileStats.rows[0],
      recentActivity
    };
  }

  static async getCaseWorkload() {
    const result = await db.query(`
      SELECT 
        u.username,
        u.id as user_id,
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE c.status = 'active') as active_cases,
        COUNT(*) FILTER (WHERE c.status = 'pending') as pending_cases,
        COUNT(*) FILTER (WHERE c.priority = 'high' OR c.priority = 'critical') as high_priority_cases,
        AVG(EXTRACT(DAY FROM (NOW() - c.created_at))) as avg_case_age_days
      FROM users u
      LEFT JOIN cases c ON u.id = c.assigned_to
      WHERE u.role = 'user'
      GROUP BY u.id, u.username
      ORDER BY total_cases DESC
    `);

    return result.rows;
  }

  static async getCaseTimeline(caseId) {
    const result = await db.query(`
      SELECT 
        'case_created' as event_type,
        c.created_at as event_time,
        cu.username as user_name,
        jsonb_build_object(
          'title', c.title,
          'priority', c.priority,
          'status', c.status
        ) as event_data
      FROM cases c
      LEFT JOIN users cu ON c.created_by = cu.id
      WHERE c.id = $1
      
      UNION ALL
      
      SELECT 
        'file_uploaded' as event_type,
        f.uploaded_at as event_time,
        u.username as user_name,
        jsonb_build_object(
          'fileName', f.file_name,
          'captureType', f.capture_type,
          'fileSize', f.file_size,
          'description', f.description,
          'sourceUrl', f.source_url
        ) as event_data
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.case_id = $1 AND f.status = 'completed'
      
      ORDER BY event_time DESC
    `, [caseId]);

    return result.rows;
  }

  static async getCasesWithFileCount() {
    const result = await db.query(`
      SELECT 
        c.*,
        u.username as assigned_to_username,
        COALESCE(f.file_count, 0) as file_count,
        COALESCE(f.total_size, 0) as total_file_size,
        COALESCE(f.screenshots, 0) as screenshot_count,
        COALESCE(f.videos, 0) as video_count,
        f.last_upload
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN (
        SELECT 
          case_id,
          COUNT(*) as file_count,
          SUM(file_size) as total_size,
          COUNT(*) FILTER (WHERE capture_type = 'screenshot') as screenshots,
          COUNT(*) FILTER (WHERE capture_type = 'video') as videos,
          MAX(COALESCE(uploaded_at, created_at)) as last_upload
        FROM files 
        WHERE status = 'completed'
        GROUP BY case_id
      ) f ON c.id = f.case_id
      ORDER BY c.updated_at DESC
    `);

    return result.rows;
  }

  static async getOverdueCases(days = 30) {
    const result = await db.query(`
      SELECT 
        c.*,
        u.username as assigned_to_username,
        EXTRACT(DAY FROM (NOW() - c.created_at)) as days_old,
        COALESCE(f.file_count, 0) as file_count
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN (
        SELECT case_id, COUNT(*) as file_count
        FROM files 
        WHERE status = 'completed'
        GROUP BY case_id
      ) f ON c.id = f.case_id
      WHERE c.status IN ('active', 'pending')
        AND c.created_at < NOW() - INTERVAL '${days} days'
      ORDER BY c.created_at ASC
    `);

    return result.rows;
  }

  static async getCasesByPriorityDistribution() {
    const result = await db.query(`
      SELECT 
        priority,
        status,
        COUNT(*) as count
      FROM cases
      GROUP BY priority, status
      ORDER BY 
        CASE priority 
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        status
    `);

    return result.rows;
  }

  static async getCaseActivitySummary(days = 30) {
    const result = await db.query(`
      SELECT 
        DATE(c.created_at) as activity_date,
        COUNT(*) as cases_created,
        COUNT(f.id) as files_uploaded,
        COALESCE(SUM(f.file_size), 0) as total_upload_size
      FROM cases c
      LEFT JOIN files f ON c.id = f.case_id 
        AND f.status = 'completed' 
        AND DATE(f.created_at) = DATE(c.created_at)
      WHERE c.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(c.created_at)
      ORDER BY activity_date DESC
    `);

    return result.rows;
  }

  static async updateCaseFromFileUpload(caseId, captureType, fileSize) {
    // This method is called when a file is uploaded to update case metadata
    const currentCase = await this.findById(caseId);
    if (!currentCase) return null;

    const metadata = currentCase.metadata || {};
    
    // Update counters
    if (captureType === 'screenshot') {
      metadata.totalScreenshots = (metadata.totalScreenshots || 0) + 1;
    } else if (captureType === 'video') {
      metadata.totalVideos = (metadata.totalVideos || 0) + 1;
    }
    
    metadata.totalFileSize = (metadata.totalFileSize || 0) + fileSize;
    metadata.lastActivity = new Date().toISOString();

    const result = await db.query(`
      UPDATE cases 
      SET metadata = $1, updated_at = NOW() 
      WHERE id = $2 
      RETURNING *
    `, [JSON.stringify(metadata), caseId]);

    return result.rows[0];
  }

  static async removeCaseFileReference(caseId, captureType, fileSize) {
    // This method is called when a file is deleted to update case metadata
    const currentCase = await this.findById(caseId);
    if (!currentCase) return null;

    const metadata = currentCase.metadata || {};
    
    // Update counters (ensure they don't go below 0)
    if (captureType === 'screenshot') {
      metadata.totalScreenshots = Math.max(0, (metadata.totalScreenshots || 0) - 1);
    } else if (captureType === 'video') {
      metadata.totalVideos = Math.max(0, (metadata.totalVideos || 0) - 1);
    }
    
    metadata.totalFileSize = Math.max(0, (metadata.totalFileSize || 0) - fileSize);
    metadata.lastActivity = new Date().toISOString();

    const result = await db.query(`
      UPDATE cases 
      SET metadata = $1, updated_at = NOW() 
      WHERE id = $2 
      RETURNING *
    `, [JSON.stringify(metadata), caseId]);

    return result.rows[0];
  }
}

module.exports = Case;