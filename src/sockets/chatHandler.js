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
        socket.emit('auth_error', { error: 'Authentication failed' });
      }
    });

    // ─── Send private message ─────────────────────────────────────────────────
    socket.on('send_private_message', async (data) => {
      // FIX: guard nếu chưa authenticate
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
          io.to(receiverSocketId).emit('receive_message', {
            message: message.toObject(),
            type: 'private',
          });
        }

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
      // FIX: guard nếu chưa authenticate
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
        console.log(`User ${socket.userId} joined group ${groupId}`);
      } catch (error) {
        console.error('Join group error:', error);
      }
    });

    // ─── Send group message ───────────────────────────────────────────────────
    socket.on('send_group_message', async (data) => {
      // FIX: guard nếu chưa authenticate
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

        const group = await Group.findById(groupId);
        if (!group || !group.members.some(m => m.user.toString() === senderId)) {
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

        // FIX: cập nhật lastMessage cho group
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
      // FIX: guard
      if (!socket.userId) return;

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
        if (!userId) return; // FIX: guard nếu chưa authenticate lúc disconnect

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
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });
    // offer call
    socket.on('call_offer', ({ to, channelName, callerName, callerAvatar, type }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('incoming_call', { from: socket.userId, channelName, callerName, callerAvatar, type });
      }
    });
    // call accepted
    socket.on('call_accept', ({ to, channelName }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_accepted', { channelName });
    });
    // call reject
    socket.on('call_reject', ({ to }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_rejected');
    });
    // call end
    socket.on('call_end', ({ to, channelName }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_ended', { channelName });
    });
   // Offer group call
    socket.on('group_call_offer', async ({ groupId, channelName, callerName, callerAvatar }) => {
      try {
        const group = await Group.findById(groupId);
        if (!group) return;

        // Lấy danh sách member online
        const memberIds = group.members.map(m => m.user.toString());
        const onlineMembers = memberIds.filter(mid => onlineUsers.has(mid));

        onlineMembers.forEach(memberId => {
          const targetSocketId = onlineUsers.get(memberId);
          if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_group_call', {
              from: socket.userId,
              groupId,
              channelName,
              callerName,
              callerAvatar,
            });
          }
        });
      } catch (error) {
        console.error('Group call offer error:', error);
      }
    });

    // Accept group call
    socket.on('group_call_accept', ({ groupId, channelName }) => {
      const group = Group.findById(groupId);
      if (!group) return;

      const memberIds = group.members.map(m => m.user.toString());
      memberIds.forEach(memberId => {
        const targetSocketId = onlineUsers.get(memberId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('group_call_accepted', { channelName });
        }
      });
    });

    // End group call
    socket.on('group_call_end', ({ groupId, channelName }) => {
      const group = Group.findById(groupId);
      if (!group) return;

      const memberIds = group.members.map(m => m.user.toString());
      memberIds.forEach(memberId => {
        const targetSocketId = onlineUsers.get(memberId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('group_call_ended', { channelName });
        }
      });
    });

    

  });
};

module.exports = { initializeSocket };