import requests
import json

def test_email_api():
    base_url = "http://localhost:3010/api/email"
    
    # Test 1: Connection Test
    print("\n1. Testing Email Service Connection...")
    try:
        response = requests.get(f"{base_url}/test")
        print("Connection Test Response:")
        print(json.dumps(response.json(), indent=2))
    except Exception as e:
        print("❌ Connection test failed:", str(e))

    # Test 2: Send Welcome Email
    print("\n2. Testing Welcome Email Send...")
    welcome_payload = {
        "to_email": "eliasnhunzwe@gmail.com",  # Using your actual email
        "subject": "Welcome to Vornify API Testing",
        "html_body": """
        <!DOCTYPE html>
        <html>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 20px rgba(0,0,0,0.1);">
                <div style="background: #2196F3; color: white; padding: 30px; text-align: center;">
                    <h1 style="margin: 0;">Welcome to Vornify!</h1>
                </div>
                <div style="padding: 30px; color: #333;">
                    <h2>Hello Elias,</h2>
                    <p>Thank you for testing the Vornify Email API. This email confirms that:</p>
                    <ul style="list-style-type: none; padding: 0;">
                        <li style="margin: 10px 0; padding-left: 20px;">✅ Email service is working</li>
                        <li style="margin: 10px 0; padding-left: 20px;">✅ HTML formatting is supported</li>
                        <li style="margin: 10px 0; padding-left: 20px;">✅ Inline styles are rendering</li>
                        <li style="margin: 10px 0; padding-left: 20px;">✅ Email delivery is successful</li>
                    </ul>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px;">
                        <h3 style="margin-top: 0; color: #2196F3;">Next Steps</h3>
                        <p>You can now integrate the email service into your applications using our API.</p>
                        <a href="https://api.vornify.se" 
                           style="display: inline-block; background: #2196F3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">
                            View API Documentation
                        </a>
                    </div>
                </div>
                <div style="background: #333; color: white; padding: 20px; text-align: center;">
                    <p style="margin: 0;">© 2024 Vornify</p>
                    <small style="color: #999;">Hammarby Sjöstad, Stockholm, Sweden</small>
                </div>
            </div>
        </body>
        </html>
        """
    }

    try:
        print("\nSending test email...")
        print("\nRequest Payload:")
        print(json.dumps({k: v[:100] + '...' if k == 'html_body' else v 
                         for k, v in welcome_payload.items()}, indent=2))
        
        response = requests.post(
            base_url,
            json=welcome_payload,
            headers={'Content-Type': 'application/json'}
        )
        
        print("\nResponse:")
        print(json.dumps(response.json(), indent=2))
        
        if response.status_code == 200 and response.json().get('status'):
            print("\n✅ Email test completed successfully!")
        else:
            print("\n❌ Email test failed!")
            
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to server. Make sure it's running on port 3010")
    except Exception as e:
        print("\n❌ Error during test:", str(e))

if __name__ == "__main__":
    print("Starting Vornify Email API Tests...")
    test_email_api() 