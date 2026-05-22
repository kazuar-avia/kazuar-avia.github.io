import requests
import json

url = "https://newsky.app/api/airline-api/flights/ongoing"

headers = {
    "Authorization": "Bearer UKR_uSTNynarbU8B8A61nvDLqmSl7Ji8xK"
}

response = requests.get(url, headers=headers)

data = response.json()

with open("newsky-live.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Saved newsky-live.json")
