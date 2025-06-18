const { cases, generateCaseId } = require("../utils/mockData");

const caseController = {
  // Get all cases with filtering and pagination
  getCases: async (req, res, next) => {
    try {
      let filteredCases = [...cases];
      const {
        status,
        priority,
        search,
        assignedTo,
        tags,
        page = 1,
        limit = 20,
      } = req.query;

      // Apply filters
      if (status) {
        const statusArray = status.split(",").map((s) => s.trim());
        filteredCases = filteredCases.filter((c) =>
          statusArray.includes(c.status)
        );
      }

      if (priority) {
        const priorityArray = priority.split(",").map((p) => p.trim());
        filteredCases = filteredCases.filter((c) =>
          priorityArray.includes(c.priority)
        );
      }

      if (assignedTo) {
        filteredCases = filteredCases.filter(
          (c) => c.assignedTo === assignedTo
        );
      }

      if (search) {
        const query = search.toLowerCase();
        filteredCases = filteredCases.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.description?.toLowerCase().includes(query) ||
            c.id.toLowerCase().includes(query) ||
            c.tags?.some((tag) => tag.toLowerCase().includes(query))
        );
      }

      if (tags) {
        const tagArray = tags.split(",").map((t) => t.trim());
        filteredCases = filteredCases.filter((c) =>
          c.tags?.some((tag) => tagArray.includes(tag))
        );
      }

      // Sort by creation date (newest first)
      filteredCases.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedCases = filteredCases.slice(startIndex, endIndex);

      // Response with pagination metadata
      res.json({
        cases: paginatedCases,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredCases.length,
          totalPages: Math.ceil(filteredCases.length / limit),
          hasNext: endIndex < filteredCases.length,
          hasPrev: page > 1,
        },
        filters: req.query,
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single case by ID
  getCaseById: async (req, res, next) => {
    try {
      const case_ = cases.find((c) => c.id === req.params.id);
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

      const newCase = {
        id: generateCaseId(),
        title: title.trim(),
        description: description?.trim(),
        status: "active",
        priority,
        createdAt: new Date().toISOString(),
        assignedTo: req.user.username,
        tags,
        metadata: {
          totalScreenshots: 0,
          totalVideos: 0,
          lastActivity: new Date().toISOString(),
          totalFileSize: 0,
        },
      };

      cases.unshift(newCase);

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
      const caseIndex = cases.findIndex((c) => c.id === req.params.id);
      if (caseIndex === -1) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      const updates = req.body;
      const updatedCase = {
        ...cases[caseIndex],
        ...updates,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...cases[caseIndex].metadata,
          lastActivity: new Date().toISOString(),
        },
      };

      cases[caseIndex] = updatedCase;

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
      const initialLength = cases.length;
      const deletedCase = cases.find((c) => c.id === req.params.id);

      if (!deletedCase) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      // Remove case from array
      const newCases = cases.filter((c) => c.id !== req.params.id);
      cases.length = 0;
      cases.push(...newCases);

      res.json({
        success: true,
        message: "Case deleted successfully",
        deletedCase: {
          id: deletedCase.id,
          title: deletedCase.title,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Update case metadata (for file uploads)
  updateCaseMetadata: async (req, res, next) => {
    try {
      const caseIndex = cases.findIndex((c) => c.id === req.params.id);
      if (caseIndex === -1) {
        return res.status(404).json({
          error: "Case not found",
          code: "CASE_NOT_FOUND",
        });
      }

      const { metadata } = req.body;

      cases[caseIndex].metadata = {
        ...cases[caseIndex].metadata,
        ...metadata,
        lastActivity: new Date().toISOString(),
      };

      cases[caseIndex].updatedAt = new Date().toISOString();

      res.json({
        success: true,
        metadata: cases[caseIndex].metadata,
        message: "Case metadata updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },

  // Get case statistics
  getCaseStats: async (req, res, next) => {
    try {
      const stats = {
        total: cases.length,
        active: cases.filter((c) => c.status === "active").length,
        pending: cases.filter((c) => c.status === "pending").length,
        closed: cases.filter((c) => c.status === "closed").length,
        archived: cases.filter((c) => c.status === "archived").length,
        byPriority: {
          low: cases.filter((c) => c.priority === "low").length,
          medium: cases.filter((c) => c.priority === "medium").length,
          high: cases.filter((c) => c.priority === "high").length,
          critical: cases.filter((c) => c.priority === "critical").length,
        },
        recentActivity: cases
          .filter((c) => c.metadata?.lastActivity)
          .sort(
            (a, b) =>
              new Date(b.metadata.lastActivity) -
              new Date(a.metadata.lastActivity)
          )
          .slice(0, 5)
          .map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            lastActivity: c.metadata.lastActivity,
          })),
        totalFiles: cases.reduce(
          (sum, c) =>
            sum +
            (c.metadata?.totalScreenshots || 0) +
            (c.metadata?.totalVideos || 0),
          0
        ),
        totalFileSize: cases.reduce(
          (sum, c) => sum + (c.metadata?.totalFileSize || 0),
          0
        ),
      };

      res.json(stats);
    } catch (error) {
      next(error);
    }
  },

  // Get available tags
  getAvailableTags: async (req, res, next) => {
    try {
      const tagSet = new Set();
      cases.forEach((case_) => {
        case_.tags?.forEach((tag) => tagSet.add(tag));
      });

      const tags = Array.from(tagSet).sort();
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

      const updatedCases = [];
      const errors = [];

      for (const caseId of caseIds) {
        const caseIndex = cases.findIndex((c) => c.id === caseId);
        if (caseIndex !== -1) {
          cases[caseIndex] = {
            ...cases[caseIndex],
            ...updates,
            updatedAt: new Date().toISOString(),
            metadata: {
              ...cases[caseIndex].metadata,
              lastActivity: new Date().toISOString(),
            },
          };
          updatedCases.push(cases[caseIndex]);
        } else {
          errors.push({ caseId, error: "Case not found" });
        }
      }

      res.json({
        success: true,
        updated: updatedCases.length,
        total: caseIds.length,
        updatedCases,
        errors,
        message: `Successfully updated ${updatedCases.length} of ${caseIds.length} cases`,
      });
    } catch (error) {
      next(error);
    }
  },

  // Export cases to CSV
  exportCases: async (req, res, next) => {
    try {
      let filteredCases = [...cases];
      const { status, priority, search, assignedTo, tags } = req.query;

      // Apply same filters as getCases
      if (status) {
        const statusArray = status.split(",").map((s) => s.trim());
        filteredCases = filteredCases.filter((c) =>
          statusArray.includes(c.status)
        );
      }

      if (priority) {
        const priorityArray = priority.split(",").map((p) => p.trim());
        filteredCases = filteredCases.filter((c) =>
          priorityArray.includes(c.priority)
        );
      }

      if (assignedTo) {
        filteredCases = filteredCases.filter(
          (c) => c.assignedTo === assignedTo
        );
      }

      if (search) {
        const query = search.toLowerCase();
        filteredCases = filteredCases.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.description?.toLowerCase().includes(query) ||
            c.id.toLowerCase().includes(query) ||
            c.tags?.some((tag) => tag.toLowerCase().includes(query))
        );
      }

      if (tags) {
        const tagArray = tags.split(",").map((t) => t.trim());
        filteredCases = filteredCases.filter((c) =>
          c.tags?.some((tag) => tagArray.includes(tag))
        );
      }

      // Generate CSV
      const headers = [
        "ID",
        "Title",
        "Status",
        "Priority",
        "Created",
        "Updated",
        "Assigned To",
        "Screenshots",
        "Videos",
        "Total Size (MB)",
        "Tags",
      ];

      const csvRows = [headers.join(",")];

      filteredCases.forEach((case_) => {
        const row = [
          case_.id,
          `"${case_.title.replace(/"/g, '""')}"`,
          case_.status,
          case_.priority,
          case_.createdAt.split("T")[0],
          case_.updatedAt ? case_.updatedAt.split("T")[0] : "",
          case_.assignedTo || "",
          case_.metadata?.totalScreenshots || 0,
          case_.metadata?.totalVideos || 0,
          case_.metadata?.totalFileSize
            ? (case_.metadata.totalFileSize / (1024 * 1024)).toFixed(2)
            : "0",
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
