const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

const onlineUsers = new Map(); // userId -> socketId

const initializeSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 New socket connection:', socket.id);
    console.log('🌐 Transport:', socket.conn.transport.name);

    // ─── Authenticate ─────────────────────────────────────────────────────────
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
      }
    });

    // ─── Send private message ─────────────────────────────────────────────────
    socket.on('send_private_message', async (data) => {
      try {
        const { receiverId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        // Parse attachments nếu là string
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

        // Gửi đến receiver nếu online
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', {
            message: message.toObject(),
            type: 'private',
          });
        }

        // Confirm cho sender
        socket.emit('message_sent', {
          messageId: message._id,
          status: 'delivered',
        });

        console.log(`📨 Private message from ${senderId} to ${receiverId}`);
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    // ─── Join group ───────────────────────────────────────────────────────────
    socket.on('join_group', async (groupId) => {
      try {
        socket.join(`group:${groupId}`);
        console.log(`User ${socket.userId} joined group ${groupId}`);
      } catch (error) {
        console.error('Join group error:', error);
      }
    });

    // ─── Send group message ───────────────────────────────────────────────────
    socket.on('send_group_message', async (data) => {
      try {
        const { groupId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        // Parse attachments nếu là string
        let parsedAttachments = attachments;
        if (typeof attachments === 'string') {
          try { parsedAttachments = JSON.parse(attachments); }
          catch { parsedAttachments = []; }
        }

        const group = await Group.findById(groupId);
        if (!group || !group.members.some(m => m.user.toString() === senderId)) {
          throw new Error('Not a group member');
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

        io.to(`group:${groupId}`).emit('receive_message', {
          message: message.toObject(),
          type: 'group',
        });

        console.log(`📢 Group message in ${groupId} from ${senderId}`);
      } catch (error) {
        console.error('Send group message error:', error);
        socket.emit('message_error', { error: 'Failed to send group message' });
      }
    });

    // ─── Typing indicator ─────────────────────────────────────────────────────
    socket.on('typing', (data) => {
      const { receiverId, isTyping, groupId } = data;
      const senderId = socket.userId;

      if (groupId) {
        socket.to(`group:${groupId}`).emit('user_typing', {
          userId: senderId,
          groupId,
          isTyping,
        });
      } else if (receiverId) {
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', {
            userId: senderId,
            isTyping,
          });
        }
      }
    });

    // ─── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const userId = socket.userId;
        if (userId) {
          onlineUsers.delete(userId);

          await User.findByIdAndUpdate(userId, {
            status: 'offline',
            lastSeen: new Date(),
          });

          socket.broadcast.emit('user_status_change', {
            userId,
            status: 'offline',
          });

          console.log(`❌ User ${userId} disconnected`);
        }
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });
  });
};

module.exports = { initializeSocket };