const User = require('../models/User');
const { cloudinary, upload } = require('../config/cloudinary');

const getUsers = async (req, res) => {
    try {
        const { search = '', page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        const query = {
            _id: { $ne: req.user._id },
            isActive: true
        };
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        const users = await User.find(query)
            .select('name email avatar status role lastSeen')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ name: 1 });
            
        const total = await User.countDocuments(query);
        
        res.json({
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('name email avatar status role createdAt lastSeen');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateProfile = async (req, res) => {
    try {
        const { name, avatar, settings } = req.body;
        const updates = {};

        if (name) updates.name = name;
        if (avatar) updates.avatar = avatar;
        if (settings) updates.settings = { ...req.user.settings, ...settings };

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true }
        ).select('name email avatar role settings');

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateStatus = async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!['online', 'offline', 'away'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const user = await User.findByIdAndUpdate(
            req.user._id,
            { status, lastSeen: new Date() },
            { new: true }
        ).select('name status lastSeen');

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getOnlineUsers = async (req, res) => {
    try {
        const onlineUsers = await User.find({
            status: 'online',
            _id: { $ne: req.user._id }
        }).select('name avatar status');

        res.json({ onlineUsers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Lưu push token ────────────────────────────────────────────────────────────
const savePushToken = async (req, res) => {
    try {
        const { pushToken } = req.body;

        if (!pushToken) {
            return res.status(400).json({ error: 'pushToken is required' });
        }

        await User.findByIdAndUpdate(req.user._id, { pushToken });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Xóa push token (khi logout) ───────────────────────────────────────────────
const removePushToken = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { pushToken: null });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: req.file.path }, // cloudinary trả về URL trong req.file.path
      { new: true }
    ).select('name email avatar role settings status');

    res.json({ user: { id: user._id, ...user.toObject() } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
module.exports = {
    getUsers,
    getUserById,
    updateProfile,
    updateStatus,
    getOnlineUsers,
    savePushToken,
    removePushToken,
    uploadAvatar, 
};