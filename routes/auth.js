const express = require("express");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");
const { validateBody, schemas } = require("../middleware/validation");

const router = express.Router();

// Login - with rate limiting and validation
router.post("/login", validateBody(schemas.login), authController.login);

// Logout - requires authentication
router.post("/logout", authenticateToken, authController.logout);

// Get current user - requires authentication
router.get("/me", authenticateToken, authController.getMe);

// Refresh token - requires authentication
router.post("/refresh", authenticateToken, authController.refresh);

module.exports = router;
