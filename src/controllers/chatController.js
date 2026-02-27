const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const File = require('../models/File');

// Get conversation history
const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20, offset = 0 } = req.query;

    // Get private chats
    const privateChats = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: userId, receiver: { $exists: true } },
            { receiver: userId }
          ],
          group: { $exists: false }
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender", userId] },
              "$receiver",
              "$sender"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $not: { $in: [userId, "$readBy"] } },
                    { $ne: ["$sender", userId] }
                  ]
                },
                1,
                0
              ]
            }
          },
          lastActivity: { $first: "$createdAt" }
        }
      },
      {
        $sort: { lastActivity: -1 }
      },
      {
        $skip: parseInt(offset)
      },
      {
        $limit: parseInt(limit)
      }
    ]);

    // Get group chats user is member of
    const groups = await Group.find({
      'members.user': userId,
      isActive: true
    }).select('name avatar description');

    const populatedChats = await Promise.all(
      privateChats.map(async (chat) => {
        const user = await User.findById(chat._id)
          .select('name avatar email status');
        return {
          type: 'private',
          id: chat._id,
          name: user?.name || 'Unknown',
          avatar: user?.avatar,
          lastMessage: chat.lastMessage?.content,
          unreadCount: chat.unreadCount,
          lastActivity: chat.lastActivity,
          status: user?.status
        };
      })
    );

    const groupChats = groups.map(group => ({
      type: 'group',
      id: group._id,
      name: group.name,
      avatar: group.avatar,
      description: group.description,
      lastMessage: null,
      unreadCount: 0,
      lastActivity: new Date()
    }));

    res.json({
      conversations: [...populatedChats, ...groupChats]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get messages between users or in group
const getMessages = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user._id;

    let query = {};
    
    // Check if target is group or user
    const isGroup = await Group.exists({ _id: targetId });
    
    if (isGroup) {
      // Check if user is member of group
      const group = await Group.findOne({
        _id: targetId,
        'members.user': userId
      });
      
      if (!group) {
        return res.status(403).json({ error: 'Not a member of this group' });
      }
      
      query = { group: targetId };
    } else {
      // Private chat
      query = {
        $or: [
          { sender: userId, receiver: targetId },
          { sender: targetId, receiver: userId }
        ],
        group: { $exists: false }
      };
    }

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('sender', 'name avatar')
      .populate('receiver', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Mark messages as read
    if (!isGroup) {
      await Message.updateMany(
        {
          sender: targetId,
          receiver: userId,
          readBy: { $ne: userId }
        },
        { $addToSet: { readBy: userId } }
      );
    }

    res.json({
      messages: messages.reverse(),
      hasMore: messages.length === parseInt(limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Send message (for REST API, socket is primary)
const sendMessage = async (req, res) => {
  try {
    const { receiverId, groupId, content, type = 'text', attachments = [] } = req.body;
    const senderId = req.user._id;

    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Message content required' });
    }

    let messageData = {
      sender: senderId,
      type,
      content: content || '',
      attachments
    };

    if (groupId) {
      // Group message
      const group = await Group.findOne({
        _id: groupId,
        'members.user': senderId
      });

      if (!group) {
        return res.status(403).json({ error: 'Not a member of this group' });
      }

      messageData.group = groupId;
    } else if (receiverId) {
      // Private message
      const receiver = await User.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      messageData.receiver = receiverId;
      messageData.readBy = [senderId];
    } else {
      return res.status(400).json({ error: 'receiverId or groupId required' });
    }

    const message = new Message(messageData);
    await message.save();

    await message.populate('sender', 'name avatar');
    if (message.receiver) {
      await message.populate('receiver', 'name avatar');
    }

    res.status(201).json({ message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Mark messages as read
const markAsRead = async (req, res) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user._id;

    await Message.updateMany(
      {
        _id: { $in: messageIds },
        readBy: { $ne: userId }
      },
      { $addToSet: { readBy: userId } }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete message
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findOne({
      _id: messageId,
      sender: userId
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found or not authorized' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Upload file
const uploadFile = async (req, res) => {
  try {
    // This would integrate with multer/cloud storage
    // For now, just accept file metadata
    const { name, url, type, size, groupId, receiverId } = req.body;
    const uploadedBy = req.user._id;

    const file = new File({
      name,
      url,
      type,
      size,
      uploadedBy,
      group: groupId || null,
      receiver: receiverId || null
    });

    await file.save();

    res.status(201).json({ file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  deleteMessage,
  uploadFile
};