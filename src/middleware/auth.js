const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    console.log('🔐 Auth middleware called');
    console.log('📌 Headers:', req.headers);
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            console.log('❌ No token provided');
            throw new Error();
        }
        console.log('✅ Token received:', token.substring(0, 20) + '...');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('🔓 Decoded:', decoded);
        const user = await User.findOne({ _id: decoded.userId, isActive: true });
        if (!user) {
            console.log('❌ User not found or inactive');
            throw new Error();
        }
        req.user = user;
        req.token = token;
        console.log('✅ Auth success for user:', user._id);
        next();
    } catch (error) {
        console.error('❌ Auth error:', error.message);
        res.status(401).json({ error: 'Please authenticate' });
    }
};
const adminAuth = async (req,res,next)=>{
    try {
        await auth(req,res,()=>{
            if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            next();
        })
    } catch (error) {
        res.status(401).json({ error: 'Please authenticate' });
    }
}
module.exports = { auth, adminAuth };