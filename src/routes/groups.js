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
  leaveGroup,
  dissolveGroup,
  promoteMember,
  demoteMember,
} = require('../controllers/groupController');

// Create new group
router.post('/', auth, createGroup);

// Get user's groups
router.get('/', auth, getUserGroups);

// Get group by ID
router.get('/:id', auth, getGroupById);

// Update group info (admin only)
router.put('/:id', auth, updateGroup);

// Add member to group (admin only)
router.post('/:id/members', auth, addMember);

// Remove member from group (admin only)
router.delete('/:id/members/:userId', auth, removeMember);

// Promote member to admin/moderator (admin only)
// PATCH /:id/members/:userId/role   body: { role: 'admin' | 'moderator' }
router.patch('/:id/members/:userId/promote', auth, promoteMember);

// Demote admin/moderator back to member (admin only)
router.patch('/:id/members/:userId/demote', auth, demoteMember);

// Leave group (self)
router.delete('/:id/leave', auth, leaveGroup);

// Dissolve group (owner only)
router.delete('/:id/dissolve', auth, dissolveGroup);

module.exports = router;