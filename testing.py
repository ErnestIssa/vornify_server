import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# One.com SMTP configuration
SMTP_SERVER = "send.one.com"
SMTP_PORT = 465
EMAIL_ADDRESS = "notification@vornify.se"
EMAIL_PASSWORD = "jdiwurshifrsjODEJIIuhxjfierufhixrjdwhhrujEEdf"

# Recipient
TO_EMAIL = "eliasnhunzwe@gmail.com"
SUBJECT = "Welcome to Vornify - Your API Solutions Partner"

# HTML Email Template with inline styles
BODY = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f4f4f4;">
    <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 20px rgba(0,0,0,0.1);">
        <div style="background: #2196F3; color: white; padding: 30px; text-align: center;">
            <svg style="width: 80px; height: 80px; margin-bottom: 20px;" viewBox="0 0 67 58" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M25.0134 5.61606C28.9281 -0.664659 38.0719 -0.664669 41.9866 5.61605L65.1066 42.7105C69.2582 49.3714 64.4689 58 56.6201 58H10.3799C2.5311 58 -2.25824 49.3714 1.89335 42.7105L25.0134 5.61606Z" fill="white"/>
                <path d="M44.9876 25.1599C49.0198 25.204 51.5789 29.4242 49.5217 32.6368L37.7091 51.0833C35.7115 54.2027 30.8308 54.0314 28.8546 50.7726L17.515 32.0731C15.5388 28.8142 17.9202 24.8642 21.8353 24.9069L44.9876 25.1599Z" fill="#333"/>
            </svg>
            <h1 style="margin: 0; font-size: 28px; color: white;">Welcome to Vornify</h1>
            <p style="margin: 10px 0 0; font-size: 18px; color: white;">Your Complete API Solutions Partner</p>
        </div>

        <div style="padding: 30px; color: #333;">
            <h2 style="color: #2196F3; margin-top: 0;">Hello Elias Luzwehimana,</h2>
            
            <p style="font-size: 16px;">Welcome to Vornify, where we simplify your development journey with powerful API solutions.</p>

            <div style="background: #f8f9fa; margin: 20px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #2196F3;">
                <h3 style="margin-top: 0; color: #2196F3;">🔥 VornifyDB</h3>
                <p style="margin-bottom: 0;">A powerful MongoDB wrapper providing simplified database operations with a single endpoint. Perfect for rapid development and easy integration.</p>
            </div>

            <div style="background: #f8f9fa; margin: 20px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #2196F3;">
                <h3 style="margin-top: 0; color: #2196F3;">💳 VornifyPay</h3>
                <p style="margin-bottom: 0;">Seamless payment integration with Stripe, supporting both one-time payments and subscriptions with minimal setup required.</p>
            </div>

            <div style="background: #f8f9fa; margin: 20px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #2196F3;">
                <h3 style="margin-top: 0; color: #2196F3;">📊 Storage Monitor</h3>
                <p style="margin-bottom: 0;">Track and optimize your database usage with detailed analytics and historical data.</p>
            </div>

            <p style="font-size: 16px;">Get started with our comprehensive documentation:</p>
            <a href="https://api.vornify.se" style="display: inline-block; padding: 12px 25px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold;">View Documentation</a>

            <p style="font-size: 16px;">Need help? Our support team is always ready to assist you in making the most of our APIs.</p>
        </div>

        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 14px;">
            <div style="margin: 20px 0;">
                <a href="https://twitter.com/vornify" style="color: white; margin: 0 10px; text-decoration: none;">Twitter</a>
                <a href="https://github.com/vornify" style="color: white; margin: 0 10px; text-decoration: none;">GitHub</a>
                <a href="https://vornify.se" style="color: white; margin: 0 10px; text-decoration: none;">Website</a>
            </div>
            <p style="margin: 10px 0;">© 2024 Vornify. All rights reserved.</p>
            <small style="color: #999;">Hammarby Sjöstad, Stockholm, Sweden</small>
        </div>
    </div>
</body>
</html>
"""

try:
    msg = MIMEMultipart()
    msg['From'] = EMAIL_ADDRESS
    msg['To'] = TO_EMAIL
    msg['Subject'] = SUBJECT
    msg.attach(MIMEText(BODY, "html"))

    server = smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT)
    server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
    server.sendmail(EMAIL_ADDRESS, TO_EMAIL, msg.as_string())
    server.quit()

    print("✅ Welcome email sent successfully to", TO_EMAIL)

except Exception as e:
    print("❌ Error sending email:", str(e))
