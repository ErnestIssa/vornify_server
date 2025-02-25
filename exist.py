#write a python script to check if a eliasnhunzwe@gmail.com is in the database of vornifydb

import requests
import json

def check_email_exists(email):
    url = "http://localhost:3010/api/vornifydb"
    
    # Prepare the verification payload
    payload = {
        "database_name": "VornifyDB",
        "collection_name": "users",
        "command": "--verify",
        "data": {
            "email": email
        }
    }
    
    try:
        print(f"\nChecking if email '{email}' exists in database...")
        print("\nRequest Payload:")
        print(json.dumps(payload, indent=2))
        
        # Send request to API
        response = requests.post(
            url,
            json=payload,
            headers={'Content-Type': 'application/json'}
        )
        
        # Print response
        print("\nResponse:")
        print(json.dumps(response.json(), indent=2))
        
        # Check if email exists using the new response format
        result = response.json()
        
        if result.get('success'):
            is_acknowledged = result.get('data', {}).get('acknowledged', False)
            if is_acknowledged:
                print(f"\n✅ Email '{email}' exists in the database")
            else:
                print(f"\n❌ Email '{email}' does not exist in the database")
            return is_acknowledged
        else:
            print(f"\n❌ Error: {result.get('error', 'Unknown error')}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to server. Make sure it's running on port 3010")
        return False
    except Exception as e:
        print(f"\n❌ Error during verification: {str(e)}")
        return False

if __name__ == "__main__":
    email_to_check = "elikasnhunzwe@gmail.com"
    check_email_exists(email_to_check)
