const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  deleteMessage,
  uploadFile
} = require('../controllers/chatController');

// Get all conversations
router.get('/conversations', auth, getConversations);

// Get messages with user/group
router.get('/messages/:targetId', auth, getMessages);

// Send message (REST fallback)
router.post('/send', auth, sendMessage);

// Mark messages as read
router.post('/mark-read', auth, markAsRead);

// Delete message
router.delete('/:messageId', auth, deleteMessage);

// Upload file
router.post('/upload', auth, uploadFile);

module.exports = router;