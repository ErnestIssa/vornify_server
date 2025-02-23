import requests
import json

def test_storage_api():
    url = "http://localhost:3010/api/storage"  # Changed to localhost:3010
    
    payload = {
        "database_name": "VornifyDB"
    }
    
    headers = {
        'Content-Type': 'application/json'
    }
    
    try:
        print("\nTesting Storage API...")
        print(f"URL: {url}")
        print("\nRequest Payload:")
        print(json.dumps(payload, indent=2))
        
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()  # Raise exception for non-200 status codes
        
        print("\nResponse:")
        print(json.dumps(response.json(), indent=2))
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Could not connect to server. Make sure the server is running on port 3010")
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Error: {str(e)}")
        if hasattr(e, 'response') and e.response is not None:
            print("\nResponse from server:")
            try:
                print(json.dumps(e.response.json(), indent=2))
            except:
                print(e.response.text)
    except Exception as e:
        print(f"\n❌ Unexpected error: {str(e)}")

if __name__ == "__main__":
    test_storage_api()