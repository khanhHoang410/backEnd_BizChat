const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary'); // ← import multer+cloudinary
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

// ✅ Upload ảnh lên Cloudinary — upload.single('file') xử lý multipart/form-data
router.post('/upload', auth, upload.single('file'), uploadFile);

module.exports = router;