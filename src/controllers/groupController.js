const Group = require('../models/Group');
const User = require('../models/User');

// Create new group
const createGroup = async (req, res) => {
      console.log('📝 CreateGroup called');
    console.log('📦 Request body:', req.body);
    console.log('👤 User:', req.user ? req.user._id : 'No user');
  try {
    const { name, description, avatar, memberIds, isPrivate = false } = req.body;
    const createdBy = req.user._id;

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
     console.error('❌ CreateGroup error:', error);
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

    const group = await Group.findOne({ _id: id, admins: userId });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can update group' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (avatar !== undefined) updates.avatar = avatar;
    if (settings) updates.settings = { ...group.settings.toObject(), ...settings };

    const updatedGroup = await Group.findByIdAndUpdate(id, updates, { new: true })
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

    const group = await Group.findOne({ _id: id, admins: adminId });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMember = group.members.some(m => m.user.toString() === userId);
    if (isMember) {
      return res.status(400).json({ error: 'User already in group' });
    }

    group.members.push({ user: userId, role: 'member' });
    await group.save();
    await group.populate('members.user', 'name avatar');

    res.json({ success: true, group, newMember: user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Remove member from group
// FIX: đổi tên biến trong filter để tránh shadow `adminId` từ outer scope
const removeMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminId = req.user._id;

    const group = await Group.findOne({ _id: id, admins: adminId });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Không cho xóa chính mình nếu là admin duy nhất
    if (userId === adminId.toString()) {
      const adminCount = group.admins.length;
      if (adminCount <= 1) {
        return res.status(400).json({
          error: 'Cannot remove the only admin. Transfer admin role first.'
        });
      }
    }

    group.members = group.members.filter(m => m.user.toString() !== userId);

    // FIX: đổi tên biến filter từ `adminId` → `aId` để không shadow outer `adminId`
    group.admins = group.admins.filter(aId => aId.toString() !== userId);

    await group.save();

    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Leave group
// FIX: chặn admin duy nhất rời nhóm khi vẫn còn thành viên khác
const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id.toString();

    const group = await Group.findById(id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const memberIndex = group.members.findIndex(m => m.user.toString() === userId);

    if (memberIndex === -1) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    const isAdmin = group.admins.some(aId => aId.toString() === userId);
    const remainingMembers = group.members.filter(m => m.user.toString() !== userId);

    // FIX: nếu là admin duy nhất mà vẫn còn thành viên khác → chặn
    if (isAdmin && group.admins.length <= 1 && remainingMembers.length > 0) {
      return res.status(400).json({
        error: 'You are the only admin. Transfer admin role to another member before leaving.'
      });
    }

    group.members.splice(memberIndex, 1);

    // FIX: dùng tên biến khác để không shadow
    group.admins = group.admins.filter(aId => aId.toString() !== userId);

    // Giải tán nhóm nếu không còn ai
    if (group.members.length === 0) {
      group.isActive = false;
    }

    await group.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Dissolve group (chỉ createdBy mới được giải tán)
const dissolveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id.toString();

    const group = await Group.findById(id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (group.createdBy.toString() !== userId) {
      return res.status(403).json({ error: 'Only the group owner can dissolve this group' });
    }

    group.isActive = false;
    group.members = [];
    group.admins = [];
    await group.save();

    res.json({ success: true, message: 'Group dissolved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// NEW: Promote member → admin hoặc moderator
const promoteMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body; // 'admin' | 'moderator'
    const adminId = req.user._id;

    if (!['admin', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or moderator.' });
    }

    const group = await Group.findOne({ _id: id, admins: adminId });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can change member roles' });
    }

    const member = group.members.find(m => m.user.toString() === userId);

    if (!member) {
      return res.status(404).json({ error: 'Member not found in group' });
    }

    // Cập nhật role trong members array
    member.role = role;

    // Nếu promote lên admin → thêm vào admins array nếu chưa có
    if (role === 'admin' && !group.admins.some(aId => aId.toString() === userId)) {
      group.admins.push(userId);
    }

    // Nếu hạ xuống moderator → xóa khỏi admins array
    if (role === 'moderator') {
      group.admins = group.admins.filter(aId => aId.toString() !== userId);
    }

    await group.save();
    await group.populate('members.user', 'name avatar email');
    await group.populate('admins', 'name avatar email');

    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// NEW: Demote admin/moderator → member
const demoteMember = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const adminId = req.user._id;

    // Chỉ admin mới được demote
    const group = await Group.findOne({ _id: id, admins: adminId });

    if (!group) {
      return res.status(403).json({ error: 'Only admins can change member roles' });
    }

    // Không cho demote chính mình nếu là admin duy nhất
    if (userId === adminId.toString() && group.admins.length <= 1) {
      return res.status(400).json({
        error: 'Cannot demote the only admin. Promote another member first.'
      });
    }

    const member = group.members.find(m => m.user.toString() === userId);

    if (!member) {
      return res.status(404).json({ error: 'Member not found in group' });
    }

    member.role = 'member';
    group.admins = group.admins.filter(aId => aId.toString() !== userId);

    await group.save();
    await group.populate('members.user', 'name avatar email');
    await group.populate('admins', 'name avatar email');

    res.json({ success: true, group });
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
  leaveGroup,
  dissolveGroup,
  promoteMember,
  demoteMember,
};