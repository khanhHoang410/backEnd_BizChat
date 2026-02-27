const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const googleAuth = async (req,res)=>{
    try {
        const {token} = req.body;
        // Verify Google Token 
       const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const {sub:goggleId,email,name,picture} = payload;

    // find or create user
    let user  = await User.findOne({email});
    if(!user){
        user = new User({
            googleId,
            email,
            name,
            avatar: picture,
        })
        await user.save();

    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = googleId;
      user.avatar = picture || user.avatar;
      await user.save();
    }
    // Update status
    user.status = 'online';
    await user.save();
    // Generate JWT
    const authToken = generateToken(user._id);
    res.status(200).json({
        user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
      },
      token: authToken,
    })
    } catch (error) {
        console.error('Google auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
    }
};
const logout = async (req,res)=>{
    try {
        req.user.status = 'offline';
        req.user.lastSeen = new Date();
        await req.user.save();
        res.status(200).json({ message: 'Logged out successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
}
const getProfile = async (req,res)=>{
  res.status(200).json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      role: req.user.role,
      status: req.user.status,
      settings: req.user.settings,
    },
  });
}
module.exports = {
  googleAuth,
  logout,
  getProfile,
};