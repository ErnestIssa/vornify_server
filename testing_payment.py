import requests
import json
from datetime import datetime

BASE_URL = "https://api.vornify.se/api/vornifypay"

def print_request(title, payload):
    """Helper function to print request details"""
    print(f"\n{title} Request Payload:")
    print(json.dumps(payload, indent=2))

def create_shoe_purchase():
    """Create a one-time payment for shoes"""
    order_id = f"order_{int(datetime.now().timestamp() * 1000)}"
    
    payload = {
        "command": "payment",
        "data": {
            "amount": 149.99,
            "currency": "usd",
            "payment_type": "onetime",
            "product_data": {
                "name": "Nike Air Max",
                "product_id": "SHOE_123",
                "size": "42",
                "color": "Black/Red",
                "order_id": order_id,
                "shipping_address": "123 Main St, City, Country",
                "customer_name": "John Doe",
                "email": "john@example.com",
                "phone": "+1234567890",
                "description": "Nike Air Max - Size 42 Black/Red"
            }
        }
    }

    print_request("Create Shoe Purchase Payment", payload)

    try:
        response = requests.post(BASE_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        print("\nPayment Creation Response:")
        print(json.dumps(result, indent=2))
        return result
    except requests.exceptions.RequestException as e:
        error_msg = str(e)
        try:
            error_json = response.json()
            error_msg = error_json.get('error', error_msg)
        except:
            pass
        print(f"\nError creating payment: {error_msg}")
        return {"status": False, "error": error_msg}

def create_subscription():
    """Create a subscription"""
    payload = {
        "command": "subscription",
        "data": {
            "customer_email": "john@example.com",
            "price_id": "price_1QtoABCZLHzBAOdTX9m2mXsL",  # Replace with your actual price ID
            "trial_days": 7,
            "product_data": {
                "plan_name": "Premium Plan",
                "features": "All Access",
                "billing_cycle": "monthly",
                "customer_name": "John Doe",
                "description": "Premium Plan Subscription",
                "product_id": "PREMIUM_PLAN_001",
                "amount": "19.99",
                "currency": "usd"
            }
        }
    }

    print_request("Create Subscription", payload)

    try:
        response = requests.post(BASE_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        print("\nSubscription Creation Response:")
        print(json.dumps(result, indent=2))
        return result
    except requests.exceptions.RequestException as e:
        error_msg = str(e)
        try:
            error_json = response.json()
            error_msg = error_json.get('error', error_msg)
        except:
            pass
        print(f"\nError creating subscription: {error_msg}")
        return {"status": False, "error": error_msg}

def verify_payment(payment_intent_id):
    """Verify a payment status"""
    payload = {
        "command": "verify",
        "data": {
            "payment_intent_id": payment_intent_id
        }
    }

    print_request("Verify Payment", payload)

    try:
        response = requests.post(BASE_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        print("\nPayment Verification Response:")
        print(json.dumps(result, indent=2))
        return result
    except requests.exceptions.RequestException as e:
        print(f"\nError verifying payment: {str(e)}")
        return {"status": False, "error": str(e)}

def main():
    print("Starting VornifyPay Test Suite...")
    
    # Test One-time Payment
    print("\n1. Testing One-time Payment...")
    payment_result = create_shoe_purchase()
    
    if payment_result.get("status"):
        print("\n2. Verifying Payment...")
        payment_intent_id = payment_result.get("payment_intent_id")
        verify_payment(payment_intent_id)
        
        print("\nPayment Integration Details:")
        print("----------------------------------------")
        print("Order Summary:")
        print(f"Amount: ${payment_result.get('amount')}")
        print(f"Currency: {payment_result.get('currency')}")
        print(f"Payment Type: {payment_result.get('payment_type')}")
        print("----------------------------------------")
        print("Technical Details:")
        print(f"1. Public key: {payment_result.get('public_key')}")
        print(f"2. Client secret: {payment_result.get('client_secret')}")
        print(f"3. Payment intent ID: {payment_result.get('payment_intent_id')}")
    else:
        print("\nPayment creation failed!")
        print("Error:", payment_result.get("error"))
    
    # Test Subscription
    print("\n3. Testing Subscription...")
    subscription_result = create_subscription()
    
    if subscription_result.get("status"):
        print("\nSubscription Integration Details:")
        print("----------------------------------------")
        print(f"Subscription ID: {subscription_result.get('subscription_id')}")
        print(f"Customer ID: {subscription_result.get('customer_id')}")
        print(f"Trial End: {subscription_result.get('trial_end')}")
    else:
        print("\nSubscription creation failed!")
        print("Error:", subscription_result.get("error"))

if __name__ == "__main__":
    main() 