const nodemailer = require('nodemailer');
require('dotenv').config();

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: "send.one.com",
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });
    }

    async sendEmail(emailData) {
        try {
            const { to_email, subject, html_body } = emailData;

            if (!to_email || !subject || !html_body) {
                return {
                    status: false,
                    error: 'Missing required fields: to_email, subject, or html_body'
                };
            }

            const mailOptions = {
                from: process.env.EMAIL_ADDRESS,
                to: to_email,
                subject: subject,
                html: html_body
            };

            const info = await this.transporter.sendMail(mailOptions);

            return {
                status: true,
                message: 'Email sent successfully',
                messageId: info.messageId,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Email sending error:', error);
            return {
                status: false,
                error: 'Failed to send email',
                details: error.message
            };
        }
    }

    async verifyConnection() {
        try {
            await this.transporter.verify();
            return true;
        } catch (error) {
            console.error('Email service verification error:', error);
            return false;
        }
    }
}

module.exports = EmailService; 