"""
Kazuar Avia — збирає FLIGHTS/archive.json з минулих тижнів (FLIGHTS/2026-Wxx.json).

Логіка нормалізації — точна копія normalizeFlight() з flights-loader.js,
тому кабінет пілота отримує ті самі дані, що й раніше, тільки одним файлом.

Запуск (з кореня репозиторію або будь-звідки):
         python scripts/build_flight_archive.py            -> архів до позаминулого тижня (минулий і поточний сайт качає окремо)
         python scripts/build_flight_archive.py --check 39 -> тільки перевірка: зібрати до W39 і порівняти з наявним archive.json
Автоматично — дія GitHub .github/workflows/build-flight-archive.yml (щопонеділка, і вручну кнопкою «Run workflow»).
"""
import json
import os
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# скрипт лежить у scripts/ репозиторію сайту → корінь репозиторію на рівень вище (можна перевизначити FLIGHTS_DIR)
SITE = Path(__file__).resolve().parent.parent
FLIGHTS = Path(os.environ.get("FLIGHTS_DIR") or SITE / "FLIGHTS")
START_WEEK = 2


# ---------- JS-семантика ----------
def truthy(v):
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True  # dict / list завжди truthy, як у JS


def js_or(*values):
    for v in values[:-1]:
        if truthy(v):
            return v
    return values[-1]


def to_number(v):
    """JS Number(v); NaN повертається як float('nan')."""
    if v is None:
        return 0
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0
        try:
            return int(s) if re.fullmatch(r"[+-]?\d+", s) else float(s)
        except ValueError:
            return float("nan")
    return float("nan")


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def num_or0(v):
    n = to_number(v)
    return n if finite(n) and n != 0 else 0


def clean(n):
    """Числа як у JSON.stringify: 5.0 -> 5, NaN -> None."""
    if isinstance(n, float):
        if not math.isfinite(n):
            return None
        if n.is_integer():
            return int(n)
    return n


def js_str(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def get(obj, *keys):
    for k in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    return obj


# ---------- копія flights-loader.js ----------
def route_type(dep, arr):
    dep_ua = js_str(js_or(dep, "")).startswith("UK")
    arr_ua = js_str(js_or(arr, "")).startswith("UK")
    if dep_ua and arr_ua:
        return "UA-UA"
    if dep_ua != arr_ua:
        return "UA-INT"
    return "INT-INT"


def touchdown_weather(flight):
    violations = get(flight, "result", "violations")
    violations = violations if isinstance(violations, list) else []

    def has_weather(v):
        w = get(v, "entry", "payload", "weather")
        return truthy(w) and finite(to_number(get(w, "windDir"))) and finite(to_number(get(w, "windSpd")))

    landing = next((v for v in violations if has_weather(v) and (
        truthy(get(v, "entry", "payload", "touchDown"))
        or re.search(r"touchdown|landing", js_str(js_or(get(v, "title"), "")), re.I)
    )), None)
    src = landing if landing is not None else next((v for v in violations if has_weather(v)), None)
    weather = get(src, "entry", "payload", "weather")
    if not truthy(weather):
        return None
    wx = to_number(weather.get("windX"))
    return {
        "windDir": clean(to_number(weather.get("windDir"))),
        "windSpd": clean(to_number(weather.get("windSpd"))),
        "crosswind": clean(abs(wx)) if finite(wx) else None,
    }


def airport_location(airport):
    location = js_or(get(airport, "location"), {})
    lat = to_number(get(location, "lat"))
    lon = to_number(get(location, "lon"))
    if finite(lat) and finite(lon):
        return {"lat": clean(lat), "lon": clean(lon), "elev": clean(num_or0(get(location, "elev")))}
    return None


def normalize_airport(airport):
    loc = airport_location(airport)
    out = {
        "icao": js_str(js_or(get(airport, "icao"), "")),
        "name": js_str(js_or(get(airport, "name"), "")),
        "city": js_str(js_or(get(airport, "city"), "")),
    }
    if loc:
        out["location"] = loc
    return out


def normalize_flight(flight, pilot, week):
    totals = js_or(get(flight, "result", "totals"), {})
    duration = num_or0(flight.get("durationAct"))
    completed = duration > 0 and truthy(js_or(flight.get("arrTimeAct"), flight.get("close")))
    dep = js_or(flight.get("dep"), {})
    arr = js_or(flight.get("arr"), {})
    aircraft = flight.get("aircraft")
    rating = flight.get("rating")
    violations = get(flight, "result", "violations")
    fid = flight.get("_id")
    if not truthy(fid):
        fid = f"{week}-{js_str(pilot.get('pilot_id'))}-{js_str(flight.get('flightNumber'))}-{js_str(flight.get('depTime'))}"
    return {
        "id": js_str(fid),
        "sourceWeek": week,
        "status": "completed" if completed else "failed",
        "pilot": {
            "id": js_str(pilot.get("pilot_id")),
            "name": js_str(js_or(pilot.get("fullname"), "Pilot")),
            "avatar": js_or(pilot.get("avatar"), None),
        },
        "flightNumber": js_str(js_or(flight.get("flightNumber"), "")),
        "flightType": js_str(js_or(flight.get("type"), "")),
        "aircraft": {
            "id": js_or(get(aircraft, "_id"), None),
            "icao": js_str(js_or(get(aircraft, "icao"), "")),
            "name": js_str(js_or(get(aircraft, "name"), get(aircraft, "icao"), "Unknown aircraft")),
            "fleetName": js_str(js_or(get(aircraft, "name"), "")),
        },
        "departure": normalize_airport(dep),
        "arrival": normalize_airport(arr),
        "actualArrival": normalize_airport(flight["actArr"]) if truthy(flight.get("actArr")) else None,
        "routeType": route_type(get(dep, "icao"), get(arr, "icao")),
        "times": {
            "scheduledDeparture": js_or(flight.get("depTime"), None),
            "scheduledArrival": js_or(flight.get("arrTime"), None),
            "actualDeparture": js_or(flight.get("depTimeAct"), None),
            "takeoff": js_or(flight.get("takeoffTimeAct"), None),
            "actualArrival": js_or(flight.get("arrTimeAct"), None),
            "closed": js_or(flight.get("close"), None),
            "durationMinutes": clean(duration),
        },
        "rating": None if rating is None else clean(to_number(rating)),
        "finance": {
            "revenue": clean(num_or0(totals.get("revenue") if isinstance(totals, dict) else None)),
            "expenses": clean(num_or0(get(totals, "expenses"))),
            "penalties": clean(num_or0(get(totals, "penalties"))),
            "balance": clean(num_or0(get(totals, "balance"))),
            "details": {
                "tickets": clean(num_or0(get(flight, "result", "revenue", "tickets"))),
                "cargo": clean(num_or0(get(flight, "result", "revenue", "cargo"))),
                "fuel": clean(num_or0(get(flight, "result", "expenses", "fuel"))),
                "aircraft": clean(num_or0(get(flight, "result", "expenses", "aircraft"))),
                "handling": clean(num_or0(get(flight, "result", "expenses", "handling"))),
                "landing": clean(num_or0(get(flight, "result", "expenses", "landing"))),
            },
            "pilotPay": None,
            "payRuleVersion": None,
        },
        "operations": {
            "distance": clean(num_or0(get(totals, "distance"))),
            "fuel": clean(num_or0(get(totals, "fuel"))),
            "passengers": clean(num_or0(get(flight, "payload", "pax"))),
            "passengersByClass": js_or(get(flight, "result", "totals", "payload", "paxByClass"), None),
            "cargo": clean(num_or0(get(flight, "payload", "cargo"))),
            "cargoWeightKg": clean(num_or0(get(flight, "payload", "weights", "cargo"))),
            "ticketPrice": clean(num_or0(get(flight, "result", "totals", "prices", "ticketPrice"))),
            "cargoUnitPrice": clean(num_or0(get(flight, "result", "totals", "prices", "cargoUnitPrice"))),
            "simulator": js_str(js_or(flight.get("simulator"), "")),
            "network": js_str(js_or(get(flight, "network", "name"), "")),
            "emergency": truthy(flight.get("emergency")),
            "free": truthy(flight.get("free")),
            "scheduled": truthy(flight.get("schedule")),
            "charter": truthy(flight.get("charter")),
            "touchdownWeather": touchdown_weather(flight),
            "violations": violations if isinstance(violations, list) else [],
        },
    }


def week_files(year=None):
    year = year or current_iso_week()[0]
    out = {}
    for f in FLIGHTS.glob(f"{year}-W*.json"):
        m = re.fullmatch(r"(\d{4})-W(\d{2})\.json", f.name)
        if m:
            out[int(m.group(2))] = f
    return dict(sorted(out.items()))


def build(through_week):
    flights = {}
    for week, f in week_files().items():
        if week < START_WEEK or week > through_week:
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        for pilot in data if isinstance(data, list) else []:
            for flight in pilot.get("flights") or []:
                nf = normalize_flight(flight, pilot, week)
                flights[nf["id"]] = nf  # як Map у браузері: пізніший тиждень перезаписує
    return list(flights.values())


def current_iso_week():
    y, w, _ = datetime.now(timezone.utc).isocalendar()
    return y, w


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        through = int(sys.argv[2])
        built = {f["id"]: f for f in build(through)}
        old = json.loads((FLIGHTS / "archive.json").read_text(encoding="utf-8"))
        old_map = {f["id"]: f for f in old["flights"]}
        same = sum(1 for k, v in old_map.items() if k in built and built[k] == v)
        diff = [k for k, v in old_map.items() if k in built and built[k] != v]
        print(f"старий архів: {len(old_map)}, зібрано: {len(built)}, однакових: {same}, різних: {len(diff)}, "
              f"нема в новому: {len(set(old_map) - set(built))}, нема в старому: {len(set(built) - set(old_map))}")
        if diff:
            a, b = old_map[diff[0]], built[diff[0]]
            for key in a:
                if a[key] != b.get(key):
                    print("перша різниця:", diff[0], key, "\n  старе:", json.dumps(a[key], ensure_ascii=False)[:400],
                          "\n  нове: ", json.dumps(b.get(key), ensure_ascii=False)[:400])
                    break
        return

    year, live_week = current_iso_week()
    # Запас 1 тиждень: в архів — до ПОЗАМИНУЛОГО тижня. Минулий сайт качає окремо (як live),
    # щоб рейс «вилетів у неділю — сів у понеділок», дописаний ботом у старий тиждень пізніше, не загубився.
    lag = int(os.environ.get("ARCHIVE_LAG_WEEKS") or 2)
    through = live_week - lag
    if through < START_WEEK:   # початок року — архівувати ще нічого (сайт качає тижні як є)
        print(f"W{live_week:02d}: архівувати нічого, пропускаю.")
        return
    flights = build(through)
    # нічого не змінилось (ті самі тижні й рейси) — файли не чіпаємо, щоб бот не комітив 11 МБ щотижня даремно
    try:
        old = json.loads((FLIGHTS / "archive.json").read_text(encoding="utf-8"))
        old_man = json.loads((FLIGHTS / "manifest.json").read_text(encoding="utf-8"))
        if old.get("throughWeek") == through and old.get("flights") == flights and old_man.get("liveWeek") == live_week:
            print(f"Без змін: архів уже W{START_WEEK:02d}-W{through:02d} ({len(flights)} рейсів).")
            return
    except (OSError, ValueError):
        pass
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    archive = {"schemaVersion": 1, "generatedAt": generated, "throughWeek": through, "flights": flights}
    manifest = {"schemaVersion": 1, "generatedAt": generated, "year": year, "archiveFile": "archive.json",
                "archiveThroughWeek": through, "archiveFlights": len(flights), "liveWeek": live_week,
                "liveFile": f"{year}-W{live_week:02d}.json"}
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    (FLIGHTS / "archive.json").write_text(dump(archive), encoding="utf-8")
    (FLIGHTS / "manifest.json").write_text(dump(manifest), encoding="utf-8")
    print(f"Готово: архів W{START_WEEK:02d}-W{through:02d}, польотів: {len(flights)}. Live-тиждень: W{live_week:02d}.")


if __name__ == "__main__":
    main()
