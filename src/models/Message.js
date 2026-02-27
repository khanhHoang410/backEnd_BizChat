const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  },
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system', 'poll', 'task'],
    default: 'text',
  },
  content: {
    type: String,
    required: true,
  },
  attachments: [{
    url: String,
    type: String,
    name: String,
    size: Number,
    thumbnail: String,
  }],
  metadata: {
    poll: {
      options: [String],
      votes: [{
        user: mongoose.Schema.Types.ObjectId,
        option: Number,
      }],
    },
    task: {
      assignee: mongoose.Schema.Types.ObjectId,
      deadline: Date,
      status: String,
    },
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  reactions: [{
    user: mongoose.Schema.Types.ObjectId,
    emoji: String,
  }],
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });
messageSchema.index({ thread: 1 });

module.exports = mongoose.model('Message', messageSchema);