const Group = require('../models/Group');
const User = require('../models/User');

// Create new group
const createGroup = async (req, res) => {
  try {
    const { name, description, avatar, memberIds, isPrivate = false } = req.body;
    const createdBy = req.user._id;

    // Create group
    const group = new Group({
      name,
      description,
      avatar,
      createdBy,
      admins: [createdBy],
      members: [
        { user: createdBy, role: 'admin' },
        ...(memberIds || []).map(id => ({ user: id, role: 'member' }))
      ],
      settings: {
        isPrivate,
        requireApproval: false,
        allowFiles: true
      }
    });

    await group.save();
    await group.populate('members.user', 'name avatar email');
    await group.populate('admins', 'name avatar email');

    res.status(201).json({ group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all groups for user
const getUserGroups = async (req, res) => {
  try {
    const userId = req.user._id;
    const { search = '' } = req.query;

    const query = {
      'members.user': userId,
      isActive: true
    };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const groups = await Group.find(query)
      .populate('members.user', 'name avatar')
      .populate('admins', 'name avatar')
      .sort({ updatedAt: -1 });

    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get group by ID
const getGroupById = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'name avatar email status')
      .populate('admins', 'name avatar email')
      .populate('createdBy', 'name avatar');

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user is member
    const isMember = group.members.some(m => 
      m.user._id.toString() === req.user._id.toString()
    );

    if (!isMember && group.settings.isPrivate) {
      return res.status(403).json({ error: 'Not a member of this private group' });
    }

    res.json({ group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update group
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, avatar, settings } = req.body;
    const userId = req.user._id;

    // Check if user is admin
    const group = await Group.findOne({
      _id: id,
      'admins': userId
    });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can update group' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (avatar !== undefined) updates.avatar = avatar;
    if (settings) updates.settings = { ...group.settings, ...settings };

    const updatedGroup = await Group.findByIdAndUpdate(
      id,
      updates,
      { new: true }
    )
    .populate('members.user', 'name avatar')
    .populate('admins', 'name avatar');

    res.json({ group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add member to group
const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    const adminId = req.user._id;

    const group = await Group.findOne({
      _id: id,
      'admins': adminId
    });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already member
    const isMember = group.members.some(m => 
      m.user.toString() === userId
    );

    if (isMember) {
      return res.status(400).json({ error: 'User already in group' });
    }

    group.members.push({ user: userId, role: 'member' });
    await group.save();

    await group.populate('members.user', 'name avatar');

    res.json({ 
      success: true, 
      group,
      newMember: user 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Remove member from group
const removeMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminId = req.user._id;

    const group = await Group.findOne({
      _id: id,
      'admins': adminId
    });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Cannot remove yourself if you're the only admin
    if (userId === adminId.toString()) {
      const adminCount = group.admins.length;
      if (adminCount <= 1) {
        return res.status(400).json({ 
          error: 'Cannot remove only admin. Transfer admin role first.' 
        });
      }
    }

    group.members = group.members.filter(m => 
      m.user.toString() !== userId
    );

    // Remove from admins if present
    group.admins = group.admins.filter(adminId => 
      adminId.toString() !== userId
    );

    await group.save();

    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Leave group
const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user is member
    const memberIndex = group.members.findIndex(m => 
      m.user.toString() === userId
    );

    if (memberIndex === -1) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    // Remove from members
    group.members.splice(memberIndex, 1);

    // Remove from admins if present
    group.admins = group.admins.filter(adminId => 
      adminId.toString() !== userId
    );

    // Delete group if no members left
    if (group.members.length === 0) {
      group.isActive = false;
    }

    await group.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroup,
  addMember,
  removeMember,
  leaveGroup
};