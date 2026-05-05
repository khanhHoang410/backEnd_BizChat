const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const File = require('../models/File');
const mongoose = require('mongoose');
const { uploadFileToSupabase } = require('../config/supabase');

const getConversations = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const { limit = 20, offset = 0 } = req.query;

    const privateChats = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: userId, receiver: { $exists: true } },
            { receiver: userId }
          ],
          group: { $exists: false },
          isDeleted: false,
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$sender', userId] }, '$receiver', '$sender']
          },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $not: { $in: [userId, '$readBy'] } },
                    { $ne: ['$sender', userId] }
                  ]
                },
                1,
                0
              ]
            }
          },
          lastActivity: { $first: '$createdAt' }
        }
      },
      { $sort: { lastActivity: -1 } },
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) }
    ]);

    const groups = await Group.find({ 'members.user': userId, isActive: true })
      .select('name avatar description lastMessage updatedAt')
      .populate('lastMessage', 'content sender createdAt type');

    const populatedChats = await Promise.all(
      privateChats.map(async (chat) => {
        const user = await User.findById(chat._id).select('name avatar email status');
        return {
          type: 'private',
          id: chat._id,
          name: user?.name || 'Unknown',
          avatar: user?.avatar,
          lastMessage: chat.lastMessage?.content || '',
          unreadCount: chat.unreadCount,
          lastActivity: chat.lastActivity,
          status: user?.status
        };
      })
    );

    const groupChats = await Promise.all(
      groups.map(async (group) => {
        const unreadCount = await Message.countDocuments({
          group: group._id,
          readBy: { $ne: userId },
          sender: { $ne: userId },
          isDeleted: false,
        });

        let lastMessageContent = '';
        let lastActivity = group.updatedAt;

        if (group.lastMessage) {
          lastMessageContent = group.lastMessage.content || '';
          lastActivity = group.lastMessage.createdAt || group.updatedAt;
        } else {
          const lastMsg = await Message.findOne({ group: group._id, isDeleted: false })
            .sort({ createdAt: -1 })
            .select('content createdAt');
          if (lastMsg) {
            lastMessageContent = lastMsg.content;
            lastActivity = lastMsg.createdAt;
          }
        }

        return {
          type: 'group',
          id: group._id,
          name: group.name,
          avatar: group.avatar,
          description: group.description,
          lastMessage: lastMessageContent,
          unreadCount,
          lastActivity,
        };
      })
    );

    const allConversations = [...populatedChats, ...groupChats].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    res.json({ conversations: allConversations });
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
      query = { group: targetId, thread: { $exists: false } };
    } else {
      query = {
        $or: [
          { sender: userId, receiver: targetId },
          { sender: targetId, receiver: userId }
        ],
        group: { $exists: false }
      };
    }

    if (before) query.createdAt = { $lt: new Date(before) };
    query.isDeleted = false;

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

      const message = new Message(messageData);
      await message.save();
      await Group.findByIdAndUpdate(groupId, { lastMessage: message._id });
      await message.populate('sender', 'name avatar');
      return res.status(201).json({ message });
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
    await Message.updateMany(
      { _id: { $in: messageIds }, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );
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

// ── Thu hồi tin nhắn ──────────────────────────────────────────────────────────
const revokeMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findOne({ _id: messageId, sender: userId });

    if (!message) {
      return res.status(404).json({ error: 'Tin nhắn không tồn tại hoặc bạn không có quyền thu hồi' });
    }

    if (message.isRevoked) {
      return res.status(400).json({ error: 'Tin nhắn đã được thu hồi trước đó' });
    }

    message.isRevoked = true;
    message.revokedAt = new Date();
    await message.save();

    res.json({ success: true, messageId: message._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { receiverId, groupId } = req.body;
    const uploadedBy = req.user._id;

    const file = new File({
      name: req.file.originalname || 'photo.jpg',
      url: req.file.path,
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

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { receiverId, groupId } = req.body;
    const uploadedBy = req.user._id;

    const mime = req.file.mimetype;
    let fileType = 'other';
    if (mime.startsWith('video/')) fileType = 'video';
    else if (mime.startsWith('audio/')) fileType = 'audio';
    else if (
      mime.includes('pdf') || mime.includes('document') ||
      mime.includes('sheet') || mime.includes('presentation') ||
      mime.includes('zip') || mime.includes('rar')
    ) fileType = 'document';

    const uploaded = await uploadFileToSupabase({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      receiverId,
      groupId,
      uploadedBy: uploadedBy.toString(),
    });

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

const getFiles = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { type } = req.query;
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
// ─── Ghim / bỏ ghim tin nhắn ────────────────────────────────────────────────
const pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Tin nhắn không tồn tại' });
    }

    // Kiểm tra quyền: chỉ người gửi hoặc admin nhóm (nếu là group) mới được ghim?
    // Ở đây tôi cho phép bất kỳ thành viên nào trong cuộc trò chuyện đều có thể ghim.
    // Nếu muốn chỉ admin nhóm mới được ghim, cần thêm logic kiểm tra group admin.

    // Kiểm tra nếu là group, người dùng có trong group không
    if (message.group) {
      const group = await Group.findOne({ _id: message.group, 'members.user': userId });
      if (!group) {
        return res.status(403).json({ error: 'Bạn không phải thành viên của nhóm này' });
      }
    } else if (message.receiver) {
      // Private: chỉ 2 người liên quan mới được ghim
      if (message.sender.toString() !== userId.toString() && message.receiver.toString() !== userId.toString()) {
        return res.status(403).json({ error: 'Bạn không có quyền ghim tin nhắn này' });
      }
    } else {
      return res.status(400).json({ error: 'Tin nhắn không hợp lệ' });
    }

    // Nếu đã ghim thì bỏ ghim, ngược lại ghim
    const isPinned = message.pinned;
    message.pinned = !isPinned;
    message.pinnedAt = isPinned ? null : new Date();
    await message.save();

    // Gửi socket update realtime
    const io = req.app.get('io'); // cần truyền io từ server.js vào
    if (io) {
      if (message.group) {
        io.to(`group:${message.group}`).emit('message_pinned', {
          messageId: message._id,
          pinned: message.pinned,
          pinnedAt: message.pinnedAt,
        });
      } else {
        // private: gửi cho cả sender và receiver
        const senderSocket = onlineUsers.get(message.sender.toString());
        const receiverSocket = onlineUsers.get(message.receiver.toString());
        if (senderSocket) io.to(senderSocket).emit('message_pinned', { messageId: message._id, pinned: message.pinned, pinnedAt: message.pinnedAt });
        if (receiverSocket) io.to(receiverSocket).emit('message_pinned', { messageId: message._id, pinned: message.pinned, pinnedAt: message.pinnedAt });
      }
    }

    res.json({ success: true, pinned: message.pinned, pinnedAt: message.pinnedAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
const getPinnedMessages = async (req, res) => {
  try {
    const { targetId } = req.params; // có thể là userId (private) hoặc groupId
    const userId = req.user._id;

    // Xác định loại conversation
    const isGroup = await Group.exists({ _id: targetId });
    let query = { pinned: true };

    if (isGroup) {
      // Kiểm tra thành viên
      const group = await Group.findOne({ _id: targetId, 'members.user': userId });
      if (!group) return res.status(403).json({ error: 'Not a member of this group' });
      query.group = targetId;
    } else {
      // Private: tin nhắn giữa userId và targetId
      query = {
        $or: [
          { sender: userId, receiver: targetId },
          { sender: targetId, receiver: userId }
        ],
        group: { $exists: false },
        pinned: true,
      };
    }

    const messages = await Message.find(query)
      .populate('sender', 'name avatar')
      .populate('receiver', 'name avatar')
      .sort({ pinnedAt: -1, createdAt: -1 }); // mới nhất lên đầu

    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getConversations, getMessages, sendMessage,
  markAsRead, deleteMessage, revokeMessage,
  uploadImage, uploadDocument, getFiles, pinMessage,
  getPinnedMessages,
  getThreadMessages, createThreadMessage, getThreadSummary,
};

// ─── Thread APIs ──────────────────────────────────────────────────────────────

async function getThreadSummary(req, res) {
  try {
    const { targetId } = req.params;
    const userId = req.user._id;
    const isGroup = await Group.exists({ _id: targetId });

    let matchQuery;
    if (isGroup) {
      const group = await Group.findOne({ _id: targetId, 'members.user': userId });
      if (!group) return res.status(403).json({ error: 'Not a member' });
      matchQuery = {
        group: new mongoose.Types.ObjectId(targetId),
        thread: { $exists: true },
        isDeleted: false,
      };
    } else {
      matchQuery = {
        $or: [
          { sender: new mongoose.Types.ObjectId(userId), receiver: new mongoose.Types.ObjectId(targetId) },
          { sender: new mongoose.Types.ObjectId(targetId), receiver: new mongoose.Types.ObjectId(userId) },
        ],
        thread: { $exists: true },
        isDeleted: false,
      };
    }

    const rows = await Message.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$thread', replyCount: { $sum: 1 }, lastReplyAt: { $max: '$createdAt' } } },
      { $sort: { lastReplyAt: -1 } },
      { $limit: 200 },
    ]);

    res.json({ threads: rows.map(r => ({ parentId: r._id, replyCount: r.replyCount, lastReplyAt: r.lastReplyAt })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getThreadMessages(req, res) {
  try {
    const { parentId } = req.params;
    const userId = req.user._id;

    const parent = await Message.findById(parentId)
      .populate('sender', 'name avatar')
      .populate('group', 'name members');

    if (!parent || parent.isDeleted) return res.status(404).json({ error: 'Parent not found' });

    // Kiểm tra quyền
    if (parent.group) {
      const group = await Group.findOne({ _id: parent.group, 'members.user': userId });
      if (!group) return res.status(403).json({ error: 'Not a member' });
    } else {
      const ok = parent.sender?._id?.toString() === userId.toString() ||
                 parent.receiver?.toString() === userId.toString();
      if (!ok) return res.status(403).json({ error: 'Not allowed' });
    }

    const messages = await Message.find({ thread: parentId, isDeleted: false })
      .populate('sender', 'name avatar')
      .sort({ createdAt: 1 });

    res.json({
      parent: { _id: parent._id, content: parent.content, type: parent.type, sender: parent.sender, createdAt: parent.createdAt },
      messages,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createThreadMessage(req, res) {
  try {
    const { parentId } = req.params;
    const { content, type = 'text' } = req.body;
    const userId = req.user._id;

    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const parent = await Message.findById(parentId);
    if (!parent || parent.isDeleted) return res.status(404).json({ error: 'Parent not found' });

    if (parent.group) {
      const group = await Group.findOne({ _id: parent.group, 'members.user': userId });
      if (!group) return res.status(403).json({ error: 'Not a member' });
    } else {
      const ok = parent.sender?.toString() === userId.toString() ||
                 parent.receiver?.toString() === userId.toString();
      if (!ok) return res.status(403).json({ error: 'Not allowed' });
    }

    const msgData = { sender: userId, thread: parentId, type, content: content.trim(), readBy: [userId] };
    if (parent.group) msgData.group = parent.group;
    else if (parent.receiver) {
      msgData.receiver = parent.sender.toString() === userId.toString() ? parent.receiver : parent.sender;
    }

    const message = new Message(msgData);
    await message.save();
    await message.populate('sender', 'name avatar');

    res.status(201).json({ message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}