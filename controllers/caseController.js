const Case = require('../models/Case');
const File = require('../models/File');

const caseController = {
  // Get all cases with filtering and pagination
  getCases: async (req, res, next) => {
    try {
      const {
        status,
        priority,
        search,
        assignedTo,
        tags,
        page = 1,
        limit = 20,
      } = req.query;

      // Build filters object
      const filters = {
        status: status ? status.split(",").map(s => s.trim()) : null,
        priority: priority ? priority.split(",").map(p => p.trim()) : null,
        search: search ? search.trim() : null,
        assignedTo: assignedTo ? assignedTo.trim() : null,
        tags: tags ? tags.split(",").map(t => t.trim()) : null,
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const result = await Case.findAll(filters);

      res.json({
        cases: result.cases,
        pagination: result.pagination,
        filters: req.query,
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single case by ID
  getCaseById: async (req, res, next) => {
    try {
      const case_ = await Case.findById(req.params.id);
      if (!case_) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }
      res.json(case_);
    } catch (error) {
      next(error);
    }
  },

  // Create new case
  createCase: async (req, res, next) => {
    try {
      const { title, description, priority = "medium", tags = [] } = req.body;

      const newCase = await Case.create({
        title: title.trim(),
        description: description?.trim(),
        priority,
        tags
      }, req.user.id);

      res.status(201).json({
        success: true,
        case: newCase,
        message: "Case created successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Update existing case
  updateCase: async (req, res, next) => {
    try {
      const updates = req.body;
      
      const updatedCase = await Case.update(req.params.id, updates);
      if (!updatedCase) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        case: updatedCase,
        message: "Case updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete case
  deleteCase: async (req, res, next) => {
    try {
      const deleted = await Case.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        message: "Case deleted successfully",
        deletedCase: {
          id: req.params.id
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Update case metadata (for file uploads)
  updateCaseMetadata: async (req, res, next) => {
    try {
      const { metadata } = req.body;

      const updatedCase = await Case.updateMetadata(req.params.id, metadata);
      if (!updatedCase) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        metadata: updatedCase.metadata,
        message: "Case metadata updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Get case statistics
  getCaseStats: async (req, res, next) => {
    try {
      const caseStats = await Case.getStats();
      const fileStats = await File.getStats();

      const stats = {
        total: parseInt(caseStats.total),
        active: parseInt(caseStats.active),
        pending: parseInt(caseStats.pending),
        closed: parseInt(caseStats.closed),
        archived: parseInt(caseStats.archived),
        byPriority: {
          low: parseInt(caseStats.low_priority),
          medium: parseInt(caseStats.medium_priority),
          high: parseInt(caseStats.high_priority),
          critical: parseInt(caseStats.critical_priority),
        },
        totalFiles: parseInt(fileStats.total_files),
        totalFileSize: parseInt(fileStats.total_size),
        filesWithDescription: parseInt(fileStats.files_with_description),
        filesWithSourceUrl: parseInt(fileStats.files_with_source_url),
        screenshots: parseInt(fileStats.screenshots),
        videos: parseInt(fileStats.videos),
        recentActivity: [] // Could be implemented with a separate query
      };

      res.json(stats);
    } catch (error) {
      next(error);
    }
  },

  // Get available tags
  getAvailableTags: async (req, res, next) => {
    try {
      const tags = await Case.getAvailableTags();
      res.json({ tags });
    } catch (error) {
      next(error);
    }
  },

  // Bulk update cases
  bulkUpdateCases: async (req, res, next) => {
    try {
      const { caseIds, updates } = req.body;

      if (!Array.isArray(caseIds) || caseIds.length === 0) {
        return res.status(400).json({
          error: "Case IDs array is required",
          code: "INVALID_CASE_IDS",
        });
      }

      const results = await Case.bulkUpdate(caseIds, updates);

      res.json({
        success: true,
        updated: results.updated,
        total: caseIds.length,
        updatedCases: results.cases,
        errors: results.errors,
        message: `Successfully updated ${results.updated} of ${caseIds.length} cases`,
      });
    } catch (error) {
      next(error);
    }
  },

  // Export cases to CSV
  exportCases: async (req, res, next) => {
    try {
      const {
        status,
        priority,
        search,
        assignedTo,
        tags
      } = req.query;

      // Build filters for export
      const filters = {
        status: status ? status.split(",").map(s => s.trim()) : null,
        priority: priority ? priority.split(",").map(p => p.trim()) : null,
        search: search ? search.trim() : null,
        assignedTo: assignedTo ? assignedTo.trim() : null,
        tags: tags ? tags.split(",").map(t => t.trim()) : null,
        page: 1,
        limit: 10000 // Large limit for export
      };

      const result = await Case.findAll(filters);
      const cases = result.cases;

      // Generate CSV
      const headers = [
        "ID",
        "Title",
        "Status",
        "Priority",
        "Created",
        "Updated",
        "Assigned To",
        "Tags",
      ];

      const csvRows = [headers.join(",")];

      cases.forEach((case_) => {
        const row = [
          case_.id,
          `"${case_.title.replace(/"/g, '""')}"`,
          case_.status,
          case_.priority,
          case_.created_at ? case_.created_at.split("T")[0] : "",
          case_.updated_at ? case_.updated_at.split("T")[0] : "",
          case_.assigned_to_username || "",
          `"${case_.tags ? case_.tags.join(";") : ""}"`,
        ];
        csvRows.push(row.join(","));
      });

      const csvData = csvRows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=cases-export-${
          new Date().toISOString().split("T")[0]
        }.csv`
      );
      res.send(csvData);
    } catch (error) {
      next(error);
    }
  },
};

module.exports = caseController;