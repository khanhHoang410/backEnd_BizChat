const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroup,
  addMember,
  removeMember,
  leaveGroup
} = require('../controllers/groupController');

// Create new group
router.post('/', auth, createGroup);

// Get user's groups
router.get('/', auth, getUserGroups);

// Get group by ID
router.get('/:id', auth, getGroupById);

// Update group
router.put('/:id', auth, updateGroup);

// Add member to group
router.post('/:id/members', auth, addMember);

// Remove member from group
router.delete('/:id/members/:userId', auth, removeMember);

// Leave group
router.delete('/:id/leave', auth, leaveGroup);

module.exports = router;