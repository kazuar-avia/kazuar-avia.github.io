import requests
import json
from datetime import datetime

TOKEN = "UKR_uSTNynarbU8B8A61nvDLqmSl7Ji8xK"

url = "https://newsky.app/api/airline-api/flights/ongoing"

headers = {
    "Authorization": f"Bearer {TOKEN}"
}

response = requests.get(url, headers=headers)

data = response.json()

flights = data.get("pilots", [])

result = []

for f in flights:

    dep = (
        f.get("dep", {})
        .get("icao", "----")
    )

    arr = (
        f.get("arr", {})
        .get("icao", "----")
    )

    airline = (
        f.get("airline", {})
        .get("icao", "---")
    )

    flight_number = (
        f.get("flightNumber", "")
    )

    aircraft = (
        f.get("aircraft", {})
        .get("airframe", {})
        .get("icao", "---")
    )

    pilot = (
        f.get("pilot", {})
        .get("fullname", "Unknown")
    )

    result.append({
        "callsign": f"{airline}{flight_number}",
        "dep": dep,
        "arr": arr,
        "aircraft": aircraft,
        "pilot": pilot
    })

output = {
    "updated": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    "flights": result
}

with open("newsky-live.json", "w", encoding="utf-8") as fp:
    json.dump(
        output,
        fp,
        ensure_ascii=False,
        indent=2
    )

with open("debug.html", "w", encoding="utf-8") as f:
    f.write(response.text)

print(
    f"Saved {len(result)} flights"
)
