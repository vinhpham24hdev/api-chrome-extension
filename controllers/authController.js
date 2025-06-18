const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { users } = require('../utils/mockData');

const authController = {
  // Login user
  login: async (req, res, next) => {
    try {
      const { username, password } = req.body;

      // Find user
      const user = users.find(u => u.username === username);
      if (!user) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS' 
        });
      }

      // Verify password
      const isValidPassword = bcrypt.compareSync(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS' 
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          id: user.id, 
          username: user.username, 
          role: user.role 
        },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      // Return success response
      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      });

    } catch (error) {
      next(error);
    }
  },

  // Logout user (client-side token removal)
  logout: async (req, res, next) => {
    try {
      res.json({ 
        success: true, 
        message: 'Logged out successfully' 
      });
    } catch (error) {
      next(error);
    }
  },

  // Get current user info
  getMe: async (req, res, next) => {
    try {
      const user = users.find(u => u.id === req.user.id);
      if (!user) {
        return res.status(404).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND' 
        });
      }

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      });
    } catch (error) {
      next(error);
    }
  },

  // Refresh token
  refresh: async (req, res, next) => {
    try {
      const user = users.find(u => u.id === req.user.id);
      if (!user) {
        return res.status(404).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND' 
        });
      }

      // Generate new token
      const token = jwt.sign(
        { 
          id: user.id, 
          username: user.username, 
          role: user.role 
        },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      res.json({
        success: true,
        token,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      });

    } catch (error) {
      next(error);
    }
  }
};

module.exports = authController;
