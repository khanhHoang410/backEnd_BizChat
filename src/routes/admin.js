const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const {
  adminLogin,
  getAnalytics,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listGroups,
  getGroupById,
  patchGroup,
  getMessagesForModeration,
} = require('../controllers/adminController');

router.post('/login', adminLogin);
router.use(adminAuth);

router.get('/analytics', getAnalytics);
router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

router.get('/groups', listGroups);
router.get('/groups/:id', getGroupById);
router.patch('/groups/:id', patchGroup);

router.get('/chat/messages/:targetId', getMessagesForModeration);

module.exports = router;
