import requests

# Your Printful API Key
API_KEY = "JdCbzPYRxkKMjZu8rwdus48RyK0sX7u0tNrCaqeJ"

# Printful API endpoint to get store products
URL = "https://api.printful.com/store/products"

# Set up headers for authentication
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Make the API request to get product list
response = requests.get(URL, headers=headers)

# Check if request was successful
if response.status_code == 200:
    products = response.json()['result']  # Get list of products
    
    # Iterate through each product to get details
    for product in products:
        product_id = product['id']
        product_url = f"{URL}/{product_id}"
        
        # Make API request for individual product details
        product_response = requests.get(product_url, headers=headers)
        
        if product_response.status_code == 200:
            product_details = product_response.json()
            print("\nProduct Details:")
            print(f"ID: {product['id']}")
            print(f"Name: {product['name']}")
            print(f"External ID: {product['external_id']}")
            print(f"Variants: {product['variants']}")
            print(f"Thumbnail URL: {product['thumbnail_url']}")
            print(f"Detailed Info: {product_details}")
            print("-" * 50)
        else:
            print(f"Error getting details for product {product_id}: {product_response.status_code}")
else:
    print(f"Error: {response.status_code}, {response.text}")  # Print error message if request fails
