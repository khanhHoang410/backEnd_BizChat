const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  getUsers,
  getUserById,
  updateProfile,
  updateStatus,
  getOnlineUsers
} = require('../controllers/userController');

// Get all users (search and pagination)
router.get('/', auth, getUsers);

// Get online users
router.get('/online', auth, getOnlineUsers);

// Get user by ID
router.get('/:id', auth, getUserById);

// Update current user profile
router.put('/profile', auth, updateProfile);

// Update user status
router.put('/status', auth, updateStatus);

module.exports = router;