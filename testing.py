import requests
import json
from datetime import datetime

BASE_URL = "https://api.vornify.se/api/vornifydb"

def print_request(title, payload):
    """Helper function to print request details"""
    print(f"\n{title} Request Payload:")
    print(json.dumps(payload, indent=2))

def create_sample_projects():
    """Create sample projects in VortexAGI database"""
    sample_projects = [
        {
            "id": f"proj_{int(datetime.now().timestamp() * 1000)}",
            "name": "Project Management System",
            "description": "A comprehensive project management solution",
            "status": "active",
            "created_at": datetime.now().isoformat(),
            "isPrivate": False
        },
        {
            "id": f"proj_{int(datetime.now().timestamp() * 1000 + 1)}",
            "name": "E-commerce Platform",
            "description": "Online shopping platform with modern features",
            "status": "planning",
            "created_at": datetime.now().isoformat(),
            "isPrivate": False
        }
    ]

    for project in sample_projects:
        payload = {
            "database_name": "VortexAGI",
            "collection_name": "projects",
            "command": "--create",
            "data": project
        }

        print_request("Create Project", payload)

        try:
            response = requests.post(BASE_URL, json=payload)
            response.raise_for_status()
            print("\nCreate Project Response:")
            print(json.dumps(response.json(), indent=2))
        except requests.exceptions.RequestException as e:
            print(f"\nError creating project: {str(e)}")
            print(f"Response content: {response.text}")
            return {"success": False, "error": str(e)}

def read_all_projects():
    """Read all projects from VortexAGI database"""
    payload = {
        "database_name": "VortexAGI",
        "collection_name": "projects",
        "command": "--read",
        "data": {}
    }

    print_request("Read All Projects", payload)

    try:
        response = requests.post(BASE_URL, json=payload)
        response.raise_for_status()
        print("\nRead Projects Response:")
        print(json.dumps(response.json(), indent=2))
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"\nError reading projects: {str(e)}")
        print(f"Response content: {response.text}")
        return {"success": False, "error": str(e)}

def main():
    print("Starting VortexAGI Projects Test...")
    print("\n1. Creating sample projects...")
    create_sample_projects()
    
    print("\n2. Reading all projects...")
    read_all_projects()

if __name__ == "__main__":
    main()


