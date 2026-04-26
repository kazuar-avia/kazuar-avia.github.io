from __future__ import annotations

from pathlib import Path
from datetime import datetime
import json
import math
import re

# === Налаштування ===
INPUT_FILE = Path(r"C:\Users\maten\Downloads\newsky-airports.txt")
OUTPUT_FILE = Path(r"C:\Users\maten\Downloads\newsky-airports-report.txt")

DIR_BEARINGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]


def parse_input_file(path: Path) -> tuple[str, list[dict]]:
    text = path.read_text(encoding="utf-8")

    updated_match = re.search(r"^UPDATED:\s*(.+)$", text, flags=re.MULTILINE)
    updated_text = updated_match.group(1).strip() if updated_match else datetime.now().strftime("%d.%m.%Y %H:%M")

    cleaned_text = re.sub(r"^UPDATED:\s*.+\n*", "", text, count=1, flags=re.MULTILINE).strip()
    blocks = [b.strip() for b in re.split(r"\n\s*---\s*\n", cleaned_text) if b.strip()]

    airports = []
    for block in blocks:
        airports.append(json.loads(block))

    return updated_text, airports


def to_rad(deg: float) -> float:
    return deg * math.pi / 180.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = to_rad(lat2 - lat1)
    dlon = to_rad(lon2 - lon1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.asin(math.sqrt(a))
    return r * c


def km_to_nm(km: float) -> float:
    return km / 1.852


def round_nm_up_to_10(nm: float) -> int:
    return int(math.ceil(nm / 10.0) * 10)


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = to_rad(lat1)
    phi2 = to_rad(lat2)
    lam1 = to_rad(lon1)
    lam2 = to_rad(lon2)

    y = math.sin(lam2 - lam1) * math.cos(phi2)
    x = (
        math.cos(phi1) * math.sin(phi2)
        - math.sin(phi1) * math.cos(phi2) * math.cos(lam2 - lam1)
    )
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angular_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return 360.0 - d if d > 180.0 else d


def pct_diff(current: float, normal: float) -> float:
    if normal == 0:
        return 0.0
    return ((current - normal) / normal) * 100.0


def fmt_signed_percent(value: float) -> str:
    return f"{value:+.0f}%"


def fmt_signed_int(value: float) -> str:
    return f"{int(round(value)):+d}"


def cargo_units_to_tons(units: float) -> int:
    return int(round((units * 82) / 1000.0))


def short_airport_name(airport: dict) -> str:
    city = airport.get("city")
    if city:
        return city

    name = airport.get("name", "")
    name = re.sub(r"\s+International Airport.*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+Airport.*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+\(.*?\)", "", name).strip()
    return name or airport["icao"]


def format_sector_members(src_airport: dict, all_airports: list[dict], sector_bearing: int) -> list[str]:
    src_icao = src_airport["icao"]
    src_lat = src_airport["location"]["lat"]
    src_lon = src_airport["location"]["lon"]

    members: list[tuple[float, str]] = []

    for dst in all_airports:
        dst_icao = dst["icao"]
        if dst_icao == src_icao:
            continue

        dst_lat = dst["location"]["lat"]
        dst_lon = dst["location"]["lon"]

        distance_km = haversine_km(src_lat, src_lon, dst_lat, dst_lon)
        distance_nm = km_to_nm(distance_km)

        if distance_nm < 50:
            continue

        brg = bearing_deg(src_lat, src_lon, dst_lat, dst_lon)
        if angular_diff(brg, sector_bearing) <= 15:
            members.append((distance_nm, dst_icao))

    members.sort(key=lambda x: x[0])
    return [f"{icao}/{round_nm_up_to_10(dist)}nm" for dist, icao in members]


def build_report(updated_text: str, airports: list[dict]) -> str:
    lines: list[str] = []
    lines.append(f"UPDATED: {updated_text}")
    lines.append("")

    for airport in airports:
        icao = airport["icao"]
        short_name = short_airport_name(airport)
        traffic_b = airport["traffic"]["B"]

        pax = traffic_b["pax"]
        cargo = traffic_b["cargo"]

        pax_now = pax["current"]
        pax_normal = pax["normal"]
        pax_delta = pax_now - pax_normal
        pax_delta_pct = pct_diff(pax_now, pax_normal)

        cargo_now_t = cargo_units_to_tons(cargo["current"])
        cargo_normal_t = cargo_units_to_tons(cargo["normal"])
        cargo_delta_t = cargo_now_t - cargo_normal_t
        cargo_delta_pct = pct_diff(cargo["current"], cargo["normal"])

        lines.append(f"{icao} ({short_name})")
        lines.append(f"{icao} pax total now: {pax_now}")
        lines.append(f"{icao} pax total normal: {pax_normal}")
        lines.append(f"{icao} cargo total now: {cargo_now_t}t")
        lines.append(f"{icao} cargo total normal: {cargo_normal_t}t")
        lines.append(f"{icao} pax difference: {fmt_signed_int(pax_delta)} pax / {fmt_signed_percent(pax_delta_pct)}")
        lines.append(f"{icao} cargo difference: {fmt_signed_int(cargo_delta_t)}t / {fmt_signed_percent(cargo_delta_pct)}")
        lines.append("")

        for idx, bearing in enumerate(DIR_BEARINGS):
            d = pax["directions"][idx]
            current = d["current"]
            normal = d["normal"]
            diff_pct = pct_diff(current, normal)
            lines.append(f"{icao}_pax_{bearing} {current} / {fmt_signed_percent(diff_pct)}")

        lines.append("")

        for idx, bearing in enumerate(DIR_BEARINGS):
            d = cargo["directions"][idx]
            current_tons = cargo_units_to_tons(d["current"])
            diff_pct = pct_diff(d["current"], d["normal"])
            lines.append(f"{icao}_cargo_{bearing} {current_tons}t / {fmt_signed_percent(diff_pct)}")

        lines.append("")

        for bearing in DIR_BEARINGS:
            members = format_sector_members(airport, airports, bearing)
            if members:
                lines.append(f"{icao}_{bearing} {' '.join(members)}")

        lines.append("")
        lines.append("-" * 60)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    updated_text, airports = parse_input_file(INPUT_FILE)
    report = build_report(updated_text, airports)
    OUTPUT_FILE.write_text(report, encoding="utf-8")
    print(f"Saved: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()