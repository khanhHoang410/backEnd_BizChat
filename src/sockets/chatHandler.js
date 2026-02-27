const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

// Store online users
const onlineUsers = new Map(); // userId -> socketId

const initializeSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 New socket connection:', socket.id);

    // User authentication via socket
    socket.on('authenticate', async (token) => {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        // Store user socket mapping
        onlineUsers.set(userId, socket.id);
        socket.userId = userId;

        // Update user status
        await User.findByIdAndUpdate(userId, {
          status: 'online',
          socketId: socket.id,
          lastSeen: new Date(),
        });

        // Join user room
        socket.join(`user:${userId}`);
        
        // Notify friends/contacts
        socket.broadcast.emit('user_status_change', {
          userId,
          status: 'online',
        });

        console.log(`✅ User ${userId} authenticated on socket`);
      } catch (error) {
        console.error('Socket authentication failed:', error);
      }
    });

    // Send private message
    socket.on('send_private_message', async (data) => {
      try {
        const { receiverId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        // Create message in DB
        const message = new Message({
          sender: senderId,
          receiver: receiverId,
          type,
          content,
          attachments,
          readBy: [senderId],
        });

        await message.save();

        // Populate sender info
        await message.populate('sender', 'name avatar');

        // Send to receiver if online
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', {
            message: message.toObject(),
            type: 'private',
          });
        }

        // Send confirmation to sender
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

    // Join group
    socket.on('join_group', async (groupId) => {
      try {
        socket.join(`group:${groupId}`);
        console.log(`User ${socket.userId} joined group ${groupId}`);
      } catch (error) {
        console.error('Join group error:', error);
      }
    });

    // Send group message
    socket.on('send_group_message', async (data) => {
      try {
        const { groupId, content, type = 'text', attachments = [] } = data;
        const senderId = socket.userId;

        // Check if user is group member
        const group = await Group.findById(groupId);
        if (!group || !group.members.some(m => m.user.toString() === senderId)) {
          throw new Error('Not a group member');
        }

        // Create message
        const message = new Message({
          sender: senderId,
          group: groupId,
          type,
          content,
          attachments,
          readBy: [senderId],
        });

        await message.save();
        await message.populate('sender', 'name avatar');

        // Update group last message
        group.lastMessage = message._id;
        await group.save();

        // Broadcast to group
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

    // Typing indicator
    socket.on('typing', (data) => {
      const { receiverId, isTyping, groupId } = data;
      const senderId = socket.userId;

      if (groupId) {
        // Group typing
        socket.to(`group:${groupId}`).emit('user_typing', {
          userId: senderId,
          groupId,
          isTyping,
        });
      } else if (receiverId) {
        // Private typing
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', {
            userId: senderId,
            isTyping,
          });
        }
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      try {
        const userId = socket.userId;
        if (userId) {
          onlineUsers.delete(userId);
          
          await User.findByIdAndUpdate(userId, {
            status: 'offline',
            lastSeen: new Date(),
          });

          // Notify contacts
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