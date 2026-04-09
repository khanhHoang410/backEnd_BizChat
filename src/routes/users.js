const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

const {
  getUsers,
  getUserById,
  updateProfile,
  updateStatus,
  getOnlineUsers,
  savePushToken,
  removePushToken,
  uploadAvatar
} = require('../controllers/userController');


router.get('/', auth, getUsers);
router.get('/online', auth, getOnlineUsers);
router.get('/:id', auth, getUserById);
router.put('/profile', auth, updateProfile);
router.put('/status', auth, updateStatus);
router.post('/avatar', auth, upload.single('file'), uploadAvatar);


// ── Push token ────────────────────────────────────────────────────────────────
router.post('/push-token', auth, savePushToken);       // lưu token khi login
router.delete('/push-token', auth, removePushToken);   // xóa token khi logout

module.exports = router;