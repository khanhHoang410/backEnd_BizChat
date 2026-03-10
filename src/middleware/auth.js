const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req,res,next)=>{
    try {
        const token = req.header('Authorization')?.replace('Bearer','');
        if(!token){
            throw new Error();
        }
        const decoded = jwt.verify(token,process.env.JWT_SECRET);
        const user = await User.findOne({_id:decoded.userId, isActive:true});
        if(!user){
            throw new Error();
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
         res.status(401).json({ error: 'Please authenticate' });
    }
}
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