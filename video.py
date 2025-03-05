#upload video to vornifydb and get the video and i can download it from vornifydb

import requests
import base64
import json
import os
from pathlib import Path

def chunk_file(file_path, chunk_size=1024*1024):  # 1MB chunks
    with open(file_path, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk

def upload_video(video_path):
    url = "http://localhost:3010/api/vornifydb"
    
    # Get file size
    file_size = Path(video_path).stat().st_size
    print(f"\nFile size: {file_size/1024/1024:.2f} MB")

    try:
        # Read and encode video in chunks
        print("\nEncoding video...")
        video_base64 = ""
        for chunk in chunk_file(video_path):
            video_base64 += base64.b64encode(chunk).decode('utf-8')

        # Upload video
        create_payload = {
            "database_name": "VornifyDB",
            "collection_name": "videos",
            "command": "--create_video",
            "data": {
                "video": f"data:video/mp4;base64,{video_base64}",
                "metadata": {
                    "title": "Test Video",
                    "description": "Testing video upload functionality",
                    "tags": ["test", "upload"],
                    "filename": os.path.basename(video_path)
                },
                "isPrivate": True
            }
        }

        print("\nUploading video...")
        response = requests.post(url, json=create_payload)
        response.raise_for_status()
        result = response.json()
        
        if result.get('success'):
            video_id = result['data']['id']
            print(f"\nVideo uploaded successfully!")
            print(f"Video ID: {video_id}")
            print(f"Size: {result['data']['size']/1024/1024:.2f} MB")
            return video_id
        else:
            print(f"Error uploading video: {result.get('error')}")
            return None

    except Exception as e:
        print(f"\nError during upload: {str(e)}")
        return None

def download_video(video_id):
    url = "http://localhost:3010/api/vornifydb"
    try:
        get_payload = {
            "database_name": "VornifyDB",
            "collection_name": "videos",
            "command": "--get_video",
            "data": {
                "id": video_id
            }
        }

        print(f"\nDownloading video with ID: {video_id}")
        response = requests.post(url, json=get_payload)
        result = response.json()

        if result.get('success'):
            try:
                # Extract base64 data from the data URI
                video_base64 = result['data']['video']
                if not video_base64:
                    raise ValueError("Received empty video data")

                # Verify data URI format
                if not video_base64.startswith('data:video/'):
                    raise ValueError("Invalid video data format")

                # Extract the base64 part
                base64_data = video_base64.split(',')[1]
                
                # Decode base64 to binary
                video_data = base64.b64decode(base64_data)
                
                # Verify we have actual video data
                if len(video_data) < 100:  # Basic sanity check
                    raise ValueError("Invalid video data size")

                filename = result['data']['metadata']['filename']
                download_path = f"downloaded_{filename}"
                
                # Write the binary data
                with open(download_path, 'wb') as f:
                    f.write(video_data)
                
                file_size = os.path.getsize(download_path)
                if file_size == 0:
                    raise ValueError("Downloaded file is empty")

                print(f"\nVideo downloaded successfully to: {download_path}")
                print(f"Size: {file_size/1024/1024:.2f} MB")

                # Verify the file exists and has content
                if not os.path.exists(download_path) or os.path.getsize(download_path) == 0:
                    raise ValueError("Failed to save video file")

                return download_path

            except Exception as e:
                print(f"\nError processing video data: {str(e)}")
                print(f"Error type: {type(e).__name__}")
                if 'download_path' in locals() and os.path.exists(download_path):
                    os.remove(download_path)  # Clean up failed download
                return None
        else:
            print(f"\nError downloading video: {result.get('error')}")
            return None

    except Exception as e:
        print(f"\nError during download: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        return None

if __name__ == "__main__":
    # You can either upload a new video or download an existing one
    choice = input("Do you want to (u)pload a new video or (d)ownload an existing one? (u/d): ").lower()

    if choice == 'u':
        # Upload new video
        video_path = r"C:\Users\elias\OneDrive\Pictures\Camera Roll\WIN_20250304_18_33_58_Pro.mp4"
        video_id = upload_video(video_path)
        
        if video_id:
            print(f"\nTo retrieve this video later, use the ID: {video_id}")
            
            # Ask if user wants to download the video
            if input("\nDo you want to download the video now? (y/n): ").lower() == 'y':
                download_path = download_video(video_id)
                if download_path:
                    print(f"\nProcess completed successfully!")
                    print(f"Original video: {video_path}")
                    print(f"Downloaded video: {download_path}")
    
    elif choice == 'd':
        # Download existing video
        video_id = input("Enter the video ID to download: ")
        download_path = download_video(video_id)
        if download_path:
            print(f"\nDownload completed successfully!")
            print(f"Downloaded video: {download_path}")
    
    else:
        print("Invalid choice. Please run again and select 'u' or 'd'.")

