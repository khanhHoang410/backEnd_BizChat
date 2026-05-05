const express = require('express');
const router = express.Router();
const multer = require('multer');
const { auth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');
const {
  getConversations, getMessages, sendMessage,
  markAsRead, deleteMessage, revokeMessage,
  uploadImage, uploadDocument, getFiles,
  pinMessage, getPinnedMessages,
  getThreadMessages, createThreadMessage, getThreadSummary,
  createPoll, votePoll,
} = require('../controllers/chatController');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (imageTypes.includes(file.mimetype)) {
      return cb(new Error('Use /upload/image for images'), false);
    }
    cb(null, true);
  }
});

// ─── Chat routes ──────────────────────────────────────────────────────────────
router.get('/conversations', auth, getConversations);
router.get('/messages/:targetId', auth, getMessages);
router.post('/send', auth, sendMessage);
router.post('/mark-read', auth, markAsRead);
router.delete('/:messageId', auth, deleteMessage);
router.patch('/:messageId/pin', auth, pinMessage);
router.get('/pinned/:targetId', auth, getPinnedMessages);
router.patch('/:messageId/revoke', auth, revokeMessage);

// ─── Thread routes ────────────────────────────────────────────────────────────
router.get('/thread-summary/:targetId', auth, getThreadSummary);
router.get('/thread/:parentId', auth, getThreadMessages);
router.post('/thread/:parentId', auth, createThreadMessage);

// ─── Poll routes ──────────────────────────────────────────────────────────────
router.post('/poll', auth, createPoll);
router.post('/poll/:messageId/vote', auth, votePoll);

// ─── Upload routes ────────────────────────────────────────────────────────────
router.post('/upload/image', auth, upload.single('file'), uploadImage);
router.post('/upload/document', auth, memoryUpload.single('file'), uploadDocument);
router.get('/files/:targetId', auth, getFiles);

module.exports = router;