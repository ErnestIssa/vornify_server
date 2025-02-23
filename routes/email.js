const express = require('express');
const router = express.Router();
const EmailService = require('../vornifyemail/emailService');

const emailService = new EmailService();

router.post('/', async (req, res) => {
    try {
        const result = await emailService.sendEmail(req.body);
        res.json(result);
    } catch (error) {
        console.error('Email route error:', error);
        res.status(500).json({
            status: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

router.get('/test', async (req, res) => {
    const isConnected = await emailService.verifyConnection();
    res.json({
        status: isConnected,
        message: isConnected ? 'Email service is connected' : 'Email service connection failed'
    });
});

module.exports = router; 