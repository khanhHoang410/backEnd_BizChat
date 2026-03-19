const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const File = require('../models/File');
const { uploadFileToSupabase } = require('../config/supabase');

const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20, offset = 0 } = req.query;

    const privateChats = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: userId, receiver: { $exists: true } }, { receiver: userId }],
          group: { $exists: false }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ['$sender', userId] }, '$receiver', '$sender'] },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $not: { $in: [userId, '$readBy'] } }, { $ne: ['$sender', userId] }] }, 1, 0]
            }
          },
          lastActivity: { $first: '$createdAt' }
        }
      },
      { $sort: { lastActivity: -1 } },
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) }
    ]);

    const groups = await Group.find({ 'members.user': userId, isActive: true }).select('name avatar description');

    const populatedChats = await Promise.all(
      privateChats.map(async (chat) => {
        const user = await User.findById(chat._id).select('name avatar email status');
        return {
          type: 'private', id: chat._id, name: user?.name || 'Unknown',
          avatar: user?.avatar, lastMessage: chat.lastMessage?.content,
          unreadCount: chat.unreadCount, lastActivity: chat.lastActivity, status: user?.status
        };
      })
    );

    const groupChats = groups.map(group => ({
      type: 'group', id: group._id, name: group.name, avatar: group.avatar,
      description: group.description, lastMessage: null, unreadCount: 0, lastActivity: new Date()
    }));

    res.json({ conversations: [...populatedChats, ...groupChats] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user._id;

    let query = {};
    const isGroup = await Group.exists({ _id: targetId });

    if (isGroup) {
      const group = await Group.findOne({ _id: targetId, 'members.user': userId });
      if (!group) return res.status(403).json({ error: 'Not a member of this group' });
      query = { group: targetId };
    } else {
      query = {
        $or: [{ sender: userId, receiver: targetId }, { sender: targetId, receiver: userId }],
        group: { $exists: false }
      };
    }

    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .populate('sender', 'name avatar')
      .populate('receiver', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    if (!isGroup) {
      await Message.updateMany(
        { sender: targetId, receiver: userId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
    }

    res.json({ messages: messages.reverse(), hasMore: messages.length === parseInt(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { receiverId, groupId, content, type = 'text', attachments = [] } = req.body;
    const senderId = req.user._id;

    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Message content required' });
    }

    let messageData = { sender: senderId, type, content: content || '', attachments };

    if (groupId) {
      const group = await Group.findOne({ _id: groupId, 'members.user': senderId });
      if (!group) return res.status(403).json({ error: 'Not a member of this group' });
      messageData.group = groupId;
    } else if (receiverId) {
      const receiver = await User.findById(receiverId);
      if (!receiver) return res.status(404).json({ error: 'Receiver not found' });
      messageData.receiver = receiverId;
      messageData.readBy = [senderId];
    } else {
      return res.status(400).json({ error: 'receiverId or groupId required' });
    }

    const message = new Message(messageData);
    await message.save();
    await message.populate('sender', 'name avatar');
    if (message.receiver) await message.populate('receiver', 'name avatar');

    res.status(201).json({ message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user._id;
    await Message.updateMany({ _id: { $in: messageIds }, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;
    const message = await Message.findOne({ _id: messageId, sender: userId });
    if (!message) return res.status(404).json({ error: 'Message not found or not authorized' });
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Upload ảnh → Cloudinary ──────────────────────────────────────────────────
const uploadImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { receiverId, groupId } = req.body;
    const uploadedBy = req.user._id;

    const file = new File({
      name: req.file.originalname || 'photo.jpg',
      url: req.file.path,       // Cloudinary trả về URL trong req.file.path
      type: 'image',
      size: req.file.size || 0,
      uploadedBy,
      group: groupId || null,
      receiver: receiverId || null,
      storageType: 'cloudinary',
    });

    await file.save();
    res.status(201).json({
      file: { _id: file._id, name: file.name, url: file.url, type: file.type, size: file.size }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Upload file/video → Supabase ─────────────────────────────────────────────
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { receiverId, groupId } = req.body;
    const uploadedBy = req.user._id;

    // Xác định loại file từ mimetype
    const mime = req.file.mimetype;
    let fileType = 'other';
    if (mime.startsWith('video/')) fileType = 'video';
    else if (mime.startsWith('audio/')) fileType = 'audio';
    else if (
      mime.includes('pdf') || mime.includes('document') ||
      mime.includes('sheet') || mime.includes('presentation') ||
      mime.includes('zip') || mime.includes('rar')
    ) fileType = 'document';

    // Upload lên Supabase Storage
    const uploaded = await uploadFileToSupabase({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      receiverId,
      groupId,
      uploadedBy: uploadedBy.toString(),
    });

    // Lưu metadata vào MongoDB
    const file = new File({
      name: uploaded.name,
      url: uploaded.url,
      type: fileType,
      size: uploaded.size,
      uploadedBy,
      group: groupId || null,
      receiver: receiverId || null,
      storageType: 'supabase',
    });

    await file.save();
    res.status(201).json({
      file: { _id: file._id, name: file.name, url: file.url, type: file.type, size: file.size }
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Lấy danh sách file theo conversation ─────────────────────────────────────
const getFiles = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { type } = req.query; // image | document | video | all
    const userId = req.user._id;

    const isGroup = await Group.exists({ _id: targetId });

    let query = {};
    if (isGroup) {
      query.group = targetId;
    } else {
      query.$or = [
        { uploadedBy: userId, receiver: targetId },
        { uploadedBy: targetId, receiver: userId },
      ];
    }

    if (type && type !== 'all') query.type = type;

    const files = await File.find(query)
      .populate('uploadedBy', 'name avatar')
      .sort({ createdAt: -1 });

    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getConversations, getMessages, sendMessage,
  markAsRead, deleteMessage,
  uploadImage, uploadDocument, getFiles,
};