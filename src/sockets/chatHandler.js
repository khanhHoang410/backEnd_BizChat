const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

const onlineUsers = new Map();

// ── Gửi push notification qua Expo Push API ───────────────────────────────────
const sendPushNotification = async ({ pushToken, title, body, data = {} }) => {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
        channelId: 'messages', // Android channel
      }),
    });
  } catch (error) {
    console.error('Push notification error:', error);
  }
};

const initializeSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 New socket connection:', socket.id);
    console.log('🌐 Transport:', socket.conn.transport.name);

    socket.on('authenticate', async (token) => {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        onlineUsers.set(userId, socket.id);
        socket.userId = userId;

        await User.findByIdAndUpdate(userId, {
          status: 'online',
          socketId: socket.id,
          lastSeen: new Date(),
        });

        socket.join(`user:${userId}`);
        socket.broadcast.emit('user_status_change', { userId, status: 'online' });
        console.log(`✅ User ${userId} authenticated on socket`);
      } catch (error) {
        console.error('Socket authentication failed:', error);
        socket.emit('auth_error', { error: 'Authentication failed' });
      }
    });

    // ── Private message ───────────────────────────────────────────────────────
    socket.on('send_private_message', async (data) => {
      if (!socket.userId) {
        return socket.emit('message_error', { error: 'Not authenticated' });
      }

      try {
        const { receiverId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        if (!receiverId || !content) {
          return socket.emit('message_error', { error: 'Missing receiverId or content' });
        }

        let parsedAttachments = attachments;
        if (typeof attachments === 'string') {
          try { parsedAttachments = JSON.parse(attachments); }
          catch { parsedAttachments = []; }
        }

        const message = new Message({
          sender: senderId,
          receiver: receiverId,
          type,
          content,
          attachments: parsedAttachments,
          readBy: [senderId],
        });

        await message.save();
        await message.populate('sender', 'name avatar');

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          // User đang online → gửi qua socket
          io.to(receiverSocketId).emit('receive_message', {
            message: message.toObject(),
            type: 'private',
          });
        } else {
          // User offline → gửi push notification
          const receiver = await User.findById(receiverId).select('pushToken settings name');
          if (receiver?.pushToken && receiver?.settings?.notifications !== false) {
            const notifBody = type === 'image' ? '📷 Đã gửi một ảnh'
              : type === 'file' ? '📎 Đã gửi một file'
              : content.length > 50 ? content.substring(0, 50) + '...'
              : content;

            await sendPushNotification({
              pushToken: receiver.pushToken,
              title: message.sender.name,
              body: notifBody,
              data: {
                type: 'private_message',
                senderId,
                messageId: message._id.toString(),
              },
            });
          }
        }

        socket.emit('message_sent', {
          messageId: message._id,
          status: 'delivered',
        });
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    socket.on('join_group', async (groupId) => {
      if (!socket.userId) {
        return socket.emit('message_error', { error: 'Not authenticated' });
      }

      try {
        const group = await Group.findOne({
          _id: groupId,
          'members.user': socket.userId,
          isActive: true,
        });

        if (!group) {
          return socket.emit('message_error', { error: 'Group not found or not a member' });
        }

        socket.join(`group:${groupId}`);
      } catch (error) {
        console.error('Join group error:', error);
      }
    });

    // ── Group message ─────────────────────────────────────────────────────────
    socket.on('send_group_message', async (data) => {
      if (!socket.userId) {
        return socket.emit('message_error', { error: 'Not authenticated' });
      }

      try {
        const { groupId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        if (!groupId || !content) {
          return socket.emit('message_error', { error: 'Missing groupId or content' });
        }

        let parsedAttachments = attachments;
        if (typeof attachments === 'string') {
          try { parsedAttachments = JSON.parse(attachments); }
          catch { parsedAttachments = []; }
        }

        const group = await Group.findById(groupId).populate('members.user', 'pushToken settings');
        if (!group || !group.members.some(m => m.user._id.toString() === senderId)) {
          return socket.emit('message_error', { error: 'Not a group member' });
        }

        const message = new Message({
          sender: senderId,
          group: groupId,
          type,
          content,
          attachments: parsedAttachments,
          readBy: [senderId],
        });

        await message.save();
        await message.populate('sender', 'name avatar');

        group.lastMessage = message._id;
        await group.save();

        // Gửi socket cho tất cả trong group
        io.to(`group:${groupId}`).emit('receive_message', {
          message: message.toObject(),
          type: 'group',
        });

        // Gửi push notification cho các member offline
        const notifBody = type === 'image' ? '📷 Đã gửi một ảnh'
          : type === 'file' ? '📎 Đã gửi một file'
          : content.length > 50 ? content.substring(0, 50) + '...'
          : content;

        const offlineMembers = group.members.filter(m => {
          const memberId = m.user._id.toString();
          return memberId !== senderId && !onlineUsers.has(memberId);
        });

        await Promise.all(offlineMembers.map(async (m) => {
          if (m.user?.pushToken && m.user?.settings?.notifications !== false) {
            await sendPushNotification({
              pushToken: m.user.pushToken,
              title: `${message.sender.name} • ${group.name}`,
              body: notifBody,
              data: {
                type: 'group_message',
                groupId,
                messageId: message._id.toString(),
              },
            });
          }
        }));

      } catch (error) {
        console.error('Send group message error:', error);
        socket.emit('message_error', { error: 'Failed to send group message' });
      }
    });

    // ── Thu hồi tin nhắn ──────────────────────────────────────────────────────
    socket.on('revoke_message', async ({ messageId, receiverId, groupId }) => {
      if (!socket.userId) return;

      try {
        const message = await Message.findOne({ _id: messageId, sender: socket.userId });
        if (!message || message.isRevoked) return;

        message.isRevoked = true;
        message.revokedAt = new Date();
        await message.save();

        if (receiverId) {
          const receiverSocketId = onlineUsers.get(receiverId);
          if (receiverSocketId) io.to(receiverSocketId).emit('message_revoked', { messageId });
        }

        if (groupId) {
          io.to(`group:${groupId}`).emit('message_revoked', { messageId });
        }

        socket.emit('message_revoked', { messageId });
      } catch (error) {
        console.error('Revoke message error:', error);
      }
    });

    // ── Typing ────────────────────────────────────────────────────────────────
    socket.on('typing', (data) => {
      if (!socket.userId) return;

      const { receiverId, isTyping, groupId } = data;
      const senderId = socket.userId;

      if (groupId) {
        socket.to(`group:${groupId}`).emit('user_typing', { userId: senderId, groupId, isTyping });
      } else if (receiverId) {
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', { userId: senderId, isTyping });
        }
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const userId = socket.userId;
        if (!userId) return;

        onlineUsers.delete(userId);

        await User.findByIdAndUpdate(userId, {
          status: 'offline',
          lastSeen: new Date(),
        });

        socket.broadcast.emit('user_status_change', { userId, status: 'offline' });
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });

    // ── Call events ───────────────────────────────────────────────────────────
    socket.on('call_offer', ({ to, channelName, callerName, callerAvatar, type }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('incoming_call', { from: socket.userId, channelName, callerName, callerAvatar, type });
      }
    });
  
    socket.on('call_accept', ({ to, channelName }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_accepted', { channelName });
    });

    socket.on('call_reject', ({ to }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_rejected');
    });

    socket.on('call_end', ({ to, channelName }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_ended', { channelName });
    });

    socket.on('group_call_offer', async ({ groupId, channelName, callerName, callerAvatar }) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return;

        const memberIds = group.members.map(m => m.user.toString());
        const onlineMembers = memberIds.filter(mid => onlineUsers.has(mid));

        onlineMembers.forEach(memberId => {
          const targetSocketId = onlineUsers.get(memberId);
          if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_group_call', {
              from: socket.userId, groupId, channelName, callerName, callerAvatar,
            });
          }
        });
      } catch (error) {
        console.error('Group call offer error:', error);
      }
    });

    socket.on('group_call_accept', ({ groupId, channelName }) => {
      const group = Group.findById(groupId);
      if (!group) return;
      const memberIds = group.members.map(m => m.user.toString());
      memberIds.forEach(memberId => {
        const targetSocketId = onlineUsers.get(memberId);
        if (targetSocketId) io.to(targetSocketId).emit('group_call_accepted', { channelName });
      });
    });

    socket.on('group_call_end', ({ groupId, channelName }) => {
      const group = Group.findById(groupId);
      if (!group) return;
      const memberIds = group.members.map(m => m.user.toString());
      memberIds.forEach(memberId => {
        const targetSocketId = onlineUsers.get(memberId);
        if (targetSocketId) io.to(targetSocketId).emit('group_call_ended', { channelName });
      });
    });
  });
};

module.exports = { initializeSocket };