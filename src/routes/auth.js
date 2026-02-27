const express = require('express');
const router = express.Router();
const { googleAuth, logout, getProfile } = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// public routes
router.post('/google', googleAuth);

// Protected routes
router.post('/logout', auth, logout);
router.get('/profile', auth, getProfile);

module.exports = router;