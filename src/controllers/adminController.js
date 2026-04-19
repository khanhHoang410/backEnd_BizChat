const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Group = require('../models/Group');
const Message = require('../models/Message');

const BCRYPT_ROUNDS = 10;

const ROLES = ['user', 'admin', 'super_admin'];
const sod = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return sod(d);
};

const popGroup = (q) =>
  q.populate('members.user', 'name avatar email status').populate('admins', 'name avatar email');

const getAnalytics = async (req, res) => {
  try {
    const now = Date.now();
    const dayMs = 864e5;
    const sevenAgo = new Date(now - 7 * dayMs);

    const [onlineUsers, messages24h, newGroups7d] = await Promise.all([
      User.find({ status: 'online', isActive: true }).select('_id name').lean(),
      Message.countDocuments({ isDeleted: false, createdAt: { $gte: new Date(now - dayMs) } }),
      Group.countDocuments({ isActive: true, createdAt: { $gte: sevenAgo } }),
    ]);

    const buckets = Array.from({ length: 7 }, (_, j) => ({
      a: daysAgo(6 - j),
      b: daysAgo(5 - j),
    }));

    const seriesRows = await Promise.all(
      buckets.map(({ a, b }) =>
        Promise.all([
          Message.countDocuments({ isDeleted: false, createdAt: { $gte: a, $lt: b } }),
          Group.countDocuments({ isActive: true, createdAt: { $gte: a, $lt: b } }),
          User.countDocuments({ isActive: true, lastSeen: { $gte: a, $lt: b } }),
        ])
      )
    );

    res.json({
      kpiActiveUsers: onlineUsers.length,
      kpiMessages24h: messages24h,
      kpiNewGroups7d: newGroups7d,
      onlineUsers,
      seriesMessages7d: seriesRows.map((r) => r[0]),
      seriesNewGroups7d: seriesRows.map((r) => r[1]),
      seriesActiveUsers7d: seriesRows.map((r) => r[2]),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const listUsers = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, includeInactive = 'true' } = req.query;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const q = {};
    if (includeInactive !== 'true') q.isActive = true;
    if (search) {
      q.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(q)
        .select('name email avatar status role lastSeen isActive createdAt')
        .skip((p - 1) * lim)
        .limit(lim)
        .sort({ createdAt: -1 }),
      User.countDocuments(q),
    ]);

    res.json({
      users,
      pagination: { page: p, limit: lim, total, pages: Math.max(1, Math.ceil(total / lim)) },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, role = 'user', password } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    let r = ROLES.includes(role) ? role : 'user';
    if ((r === 'admin' || r === 'super_admin') && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super_admin can assign admin/super_admin' });
    }

    const em = email.toLowerCase().trim();
    if (await User.exists({ email: em })) return res.status(409).json({ error: 'Email already registered' });

    const payload = {
      name: name.trim(),
      email: em,
      role: r,
      status: 'offline',
      isActive: true,
    };
    if (password != null && String(password).length > 0) {
      if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
      payload.passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    }

    const user = await User.create(payload);

    res.status(201).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        isActive: user.isActive,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, status, role, isActive, password } = req.body;
    const target = await User.findById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const $set = {};
    if (name !== undefined) $set.name = String(name).trim();
    if (email !== undefined) {
      const e = String(email).toLowerCase().trim();
      if (await User.exists({ email: e, _id: { $ne: id } })) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      $set.email = e;
    }
    if (status !== undefined) {
      if (!['online', 'offline', 'away'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      $set.status = status;
      $set.lastSeen = new Date();
    }
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      if (role === 'super_admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super_admin can assign super_admin' });
      }
      if (role === 'admin' && !['admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      $set.role = role;
    }
    if (isActive !== undefined) {
      if (target._id.equals(req.user._id) && isActive === false) {
        return res.status(400).json({ error: 'Cannot deactivate yourself' });
      }
      $set.isActive = Boolean(isActive);
    }
    if (password !== undefined && password !== '') {
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'password must be at least 6 characters' });
      }
      $set.passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    }

    const user = await User.findByIdAndUpdate(id, { $set }, { new: true }).select(
      'name email avatar status role lastSeen isActive createdAt'
    );
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isActive: false, status: 'offline' } },
      { new: true }
    ).select('name email isActive');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deactivated', user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const listGroups = async (req, res) => {
  try {
    const { search = '', includeInactive = 'false' } = req.query;
    const q = {};
    if (includeInactive !== 'true') q.isActive = true;
    if (search) q.name = { $regex: search, $options: 'i' };

    const groups = await popGroup(Group.find(q).sort({ updatedAt: -1 }));
    res.json({ groups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const getGroupById = async (req, res) => {
  try {
    const group = await popGroup(Group.findById(req.params.id)).populate('createdBy', 'name avatar email');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const patchGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, settings } = req.body;
    const $set = {};
    if (typeof isActive === 'boolean') $set.isActive = isActive;
    if (settings && typeof settings === 'object') {
      const g = await Group.findById(id);
      if (!g) return res.status(404).json({ error: 'Group not found' });
      const prev =
        g.settings && typeof g.settings.toObject === 'function'
          ? g.settings.toObject()
          : { ...(g.settings || {}) };
      $set.settings = { ...prev, ...settings };
    }
    if (!Object.keys($set).length) return res.status(400).json({ error: 'No valid fields' });
    $set.updatedAt = new Date();

    const group = await popGroup(Group.findByIdAndUpdate(id, { $set }, { new: true }));
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const getMessagesForModeration = async (req, res) => {
  try {
    const { targetId } = req.params;
    const lim = parseInt(req.query.limit, 10) || 50;
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'Invalid target id' });
    }

    const base = { isDeleted: false };
    let q;
    if (await Group.exists({ _id: targetId })) {
      q = { ...base, group: targetId };
    } else if (await User.exists({ _id: targetId })) {
      q = { ...base, $or: [{ sender: targetId }, { receiver: targetId }], group: { $exists: false } };
    } else {
      return res.status(404).json({ error: 'User or group not found' });
    }

    const messages = await Message.find(q)
      .populate('sender', 'name avatar email')
      .populate('receiver', 'name avatar email')
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();

    const list = messages.reverse();
    res.json({ messages: list, hasMore: list.length === lim });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports = {
  getAnalytics,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listGroups,
  getGroupById,
  patchGroup,
  getMessagesForModeration,
};
