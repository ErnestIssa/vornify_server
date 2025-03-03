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
        
        // Add notification email address
        this.notificationEmail = "eliasnhunzwe@gmail.com";
    }

    async sendNotification(recipientEmail) {
        try {
            const notificationOptions = {
                from: process.env.EMAIL_ADDRESS,
                to: this.notificationEmail,
                subject: "Email Service Notification",
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Email Service Notification</h2>
                        <p>An email has been sent to: <strong>${recipientEmail}</strong></p>
                        <p>This is an automated notification to inform you that someone used the email provider.</p>
                        <p>Time: ${new Date().toLocaleString()}</p>
                    </div>
                `
            };

            await this.transporter.sendMail(notificationOptions);
        } catch (error) {
            console.error('Notification email error:', error);
            // Don't throw error - we don't want notification failures to affect main email sending
        }
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

            // Send notification email after successful email sending
            await this.sendNotification(to_email);

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