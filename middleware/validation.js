const Joi = require("joi");

const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: "Validation failed",
        details: error.details.map((d) => d.message),
        code: "VALIDATION_ERROR",
      });
    }
    req.body = value;
    next();
  };
};

const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: "Query validation failed",
        details: error.details.map((d) => d.message),
        code: "VALIDATION_ERROR",
      });
    }
    req.query = value;
    next();
  };
};

// Validation schemas
const schemas = {
  login: Joi.object({
    username: Joi.string().required().min(3).max(50),
    password: Joi.string().required().min(3),
  }),

  createCase: Joi.object({
    title: Joi.string().required().min(1).max(200),
    description: Joi.string().optional().max(1000),
    priority: Joi.string()
      .valid("low", "medium", "high", "critical")
      .default("medium"),
    tags: Joi.array().items(Joi.string().max(50)).default([]),
  }),

  updateCase: Joi.object({
    title: Joi.string().optional().min(1).max(200),
    description: Joi.string().optional().max(1000),
    status: Joi.string()
      .valid("active", "pending", "closed", "archived")
      .optional(),
    priority: Joi.string()
      .valid("low", "medium", "high", "critical")
      .optional(),
    tags: Joi.array().items(Joi.string().max(50)).optional(),
  }),

  presignedUrl: Joi.object({
    fileName: Joi.string().required(),
    fileType: Joi.string().required(),
    caseId: Joi.string().required(),
    captureType: Joi.string().valid("screenshot", "video").required(),
    fileSize: Joi.number().positive().optional(),
    userId: Joi.string().optional(),
  }),

  caseQuery: Joi.object({
    status: Joi.string().optional(),
    priority: Joi.string().optional(),
    search: Joi.string().optional(),
    assignedTo: Joi.string().optional(),
    tags: Joi.string().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

module.exports = {
  validateBody,
  validateQuery,
  schemas,
};
