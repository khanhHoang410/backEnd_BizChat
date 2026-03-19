const express = require('express');
const router = express.Router();
const multer = require('multer');
const { auth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');       // multer + Cloudinary (ảnh)
const {
  getConversations, getMessages, sendMessage,
  markAsRead, deleteMessage,
  uploadImage, uploadDocument, getFiles,
} = require('../controllers/chatController');

// Multer memory storage cho file → Supabase
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // max 50MB
  fileFilter: (req, file, cb) => {
    // Chặn file ảnh — ảnh dùng route /upload/image
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

// ─── Upload routes ────────────────────────────────────────────────────────────
// Ảnh → Cloudinary
router.post('/upload/image', auth, upload.single('file'), uploadImage);

// File/Video → Supabase
router.post('/upload/document', auth, memoryUpload.single('file'), uploadDocument);

// Lấy danh sách file của conversation
// GET /api/chat/files/:targetId?type=image|document|video|all
router.get('/files/:targetId', auth, getFiles);

module.exports = router;