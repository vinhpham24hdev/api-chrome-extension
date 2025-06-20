// models/Case.js - Case model with PostgreSQL
const db = require('../config/database');

class Case {
  static async findAll(filters = {}) {
    let query = `
      SELECT c.*, u.username as assigned_to_username 
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
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
      query += ` AND (c.title ILIKE $${paramCount} OR c.description ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
    }

    // Pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;

    query += ` ORDER BY c.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    
    // Get total count
    const countResult = await db.query('SELECT COUNT(*) FROM cases WHERE 1=1');
    const total = parseInt(countResult.rows[0].count);

    return {
      cases: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  static async findById(id) {
    const result = await db.query(
      'SELECT c.*, u.username as assigned_to_username FROM cases c LEFT JOIN users u ON c.assigned_to = u.id WHERE c.id = $1',
      [id]
    );
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
    `, [id, title, description, priority, createdBy, tags, {}]);

    return result.rows[0];
  }

  static async update(id, updates) {
    const fields = [];
    const values = [];
    let paramCount = 0;

    Object.entries(updates).forEach(([key, value]) => {
      if (['title', 'description', 'status', 'priority', 'assigned_to', 'tags'].includes(key)) {
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
    
    const fileStats = await db.query(`
      SELECT 
        COUNT(*) as total_files,
        COALESCE(SUM(file_size), 0) as total_file_size
      FROM files 
      WHERE status = 'completed'
    `);

    return {
      ...result.rows[0],
      ...fileStats.rows[0]
    };
  }

  static async updateMetadata(id, metadata) {
    const result = await db.query(
      'UPDATE cases SET metadata = metadata || $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [JSON.stringify(metadata), id]
    );
    return result.rows[0];
  }
}

module.exports = Case;
