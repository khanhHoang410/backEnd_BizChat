const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const router = express.Router();

router.post('/token', async (req, res) => {
  try {
    const { channelName, uid, role } = req.body;
    
    // Lấy từ env
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    
    if (!appId || !appCertificate) {
      return res.status(500).json({ error: 'Agora credentials not configured' });
    }
    
    // Token hết hạn sau 1 giờ
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
    
    // role: 1 = publisher, 2 = subscriber
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, appCertificate, channelName, uid, 
      role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER, 
      privilegeExpiredTs
    );
    
    res.json({ token, appId, channelName, uid });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

module.exports = router;

