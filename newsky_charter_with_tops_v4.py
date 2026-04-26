from pathlib import Path
import re
from typing import Dict, List, Tuple, Optional

# =========================
# НАЛАШТУВАННЯ
# =========================

BASE_DIR = Path(os.path.dirname(os.path.abspath(__file__)))

INPUT_FILE = BASE_DIR / "newsky-airports-report.txt"
OUTPUT_FILE = BASE_DIR / "newsky-charter-results.tx

MAX_DISTANCE_NM = 1500

MIN_PAX_AMOUNT = 50
MIN_CARGO_AMOUNT = 10

MAX_DISPLAY_PAX = 450
MAX_DISPLAY_CARGO = 99

# Дільник для outbound-рекомендації
AMOUNT_DIVISOR = 3.7

# Дільник для inbound-рекомендації з аеропорту вильоту
INBOUND_AMOUNT_DIVISOR = 3.5

# Дільник для максимального прийому inbound в аеропорту прибуття
INBOUND_DESTINATION_CAP_DIVISOR = 2

DIRECTIONS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

# Твоя таблиця зворотних напрямків:
REVERSE_DIRECTION = {
    0: 150,
    30: 180,
    60: 210,
    90: 240,
    120: 270,
    150: 300,
    180: 330,
    210: 0,
    240: 30,
    270: 60,
    300: 90,
    330: 120,
}

# Фільтри для outbound-логіки:
REQUIRE_ORIGIN_NON_NEGATIVE = True
REQUIRE_TARGET_NON_POSITIVE = True


# =========================
# ДОПОМІЖНІ ФУНКЦІЇ
# =========================

def parse_percent(text: str) -> int:
    return int(text.replace("%", "").replace("+", ""))


def recommended_amount(value: int, percent: int) -> int:
    """
    Outbound:
    value / 3.7 * (100% + percent)
    """
    result = (value / AMOUNT_DIVISOR) * (1 + percent / 100)
    return int(result + 0.5)


def inbound_source_amount(value: int) -> int:
    """
    Inbound source:
    скільки може вилетіти з аеропорту-джерела.

    Формула:
    source value / 3.5
    """
    return int((value / INBOUND_AMOUNT_DIVISOR) + 0.5)


def inbound_destination_cap(value: int) -> int:
    """
    Inbound destination cap:
    скільки максимум може прийняти український аеропорт прибуття.

    Формула:
    destination value / 2
    """
    return int((value / INBOUND_DESTINATION_CAP_DIVISOR) + 0.5)


def inbound_amount(source_value: int, destination_value: int) -> int:
    """
    Фінальна inbound кількість:
    беремо мінімум між:
    - source value / 3.5
    - destination value / 2

    Приклад:
    UKCW_pax_270 831 / +0% -> 831 / 3.5 = 237
    UKHS_pax_120 344 / -1% -> 344 / 3 = 115
    результат: ~115 pax
    """
    return min(
        inbound_source_amount(source_value),
        inbound_destination_cap(destination_value)
    )


def min_amount_for_mode(mode: str) -> int:
    return MIN_PAX_AMOUNT if mode == "pax" else MIN_CARGO_AMOUNT


def format_amount(mode: str, amount: int) -> str:
    """
    Для детальних рядків:
    - cargo більше 99t показуємо як >99t
    - pax більше 450 показуємо як >450 pax
    """
    if mode == "cargo":
        if amount > MAX_DISPLAY_CARGO:
            return f">{MAX_DISPLAY_CARGO}t"
        return f"~{amount} t"

    if amount > MAX_DISPLAY_PAX:
        return f">{MAX_DISPLAY_PAX} pax"
    return f"~{amount} pax"


def format_top_amount(mode: str, amount: int) -> str:
    """
    Для ТОП-блоків: коротше, без ~.
    """
    if mode == "cargo":
        if amount > MAX_DISPLAY_CARGO:
            return f">{MAX_DISPLAY_CARGO}т"
        return f"{amount}т"

    if amount > MAX_DISPLAY_PAX:
        return f">{MAX_DISPLAY_PAX} pax"
    return f"{amount} pax"


def is_uk(code: str) -> bool:
    return code.startswith("UK")


ICAO_PREFIX_FLAGS = {
    "UK": "🇺🇦",
    "UR": "🇺🇦",

    "EP": "🇵🇱",
    "ED": "🇩🇪",
    "ET": "🇩🇪",
    "EH": "🇳🇱",
    "EB": "🇧🇪",
    "EL": "🇱🇺",
    "LS": "🇨🇭",
    "LK": "🇨🇿",
    "LZ": "🇸🇰",
    "LO": "🇦🇹",
    "LH": "🇭🇺",
    "LR": "🇷🇴",
    "LQ": "🇧🇦",
    "LY": "🇷🇸",
    "LD": "🇭🇷",
    "LJ": "🇸🇮",
    "LI": "🇮🇹",
    "LB": "🇧🇬",
    "LW": "🇲🇰",
    "LA": "🇦🇱",
    "LG": "🇬🇷",
    "LC": "🇨🇾",
    "LT": "🇹🇷",
    "LU": "🇲🇩",

    "LF": "🇫🇷",
    "LE": "🇪🇸",
    "LP": "🇵🇹",
    "EG": "🇬🇧",
    "EI": "🇮🇪",
    "ES": "🇸🇪",
    "EF": "🇫🇮",
    "EN": "🇳🇴",
    "EY": "🇱🇹",
    "EV": "🇱🇻",
    "EE": "🇪🇪",

    "UG": "🇬🇪",
    "UD": "🇦🇲",
    "UB": "🇦🇿",
    "UA": "🇰🇿",
    "UT": "🇺🇿",

    "OI": "🇮🇷",
    "OR": "🇮🇶",
    "OJ": "🇯🇴",
    "OL": "🇱🇧",
    "LL": "🇮🇱",
    "OE": "🇸🇦",
    "OM": "🇦🇪",
    "HE": "🇪🇬",
    "DT": "🇹🇳",
    "GM": "🇲🇦",

    "VI": "🇮🇳",
    "VT": "🇹🇭",
    "VH": "🇭🇰",
    "ZB": "🇨🇳",

    "KJ": "🇺🇸",
    "CY": "🇨🇦",
    "MD": "🇩🇴",
    "MM": "🇲🇽",
}


def flag_for_airport(code: str) -> str:
    """
    Прапор для TOP-рядків. Якщо код невідомий — без прапора.
    """
    return ICAO_PREFIX_FLAGS.get(code[:2], "")


def code_with_flag(code: str) -> str:
    flag = flag_for_airport(code)
    return f"{code} {flag}" if flag else code


def icon_for_mode(mode: str) -> str:
    return "📦" if mode == "cargo" else "👨‍💼"


# =========================
# ПАРСИНГ
# =========================

def parse_report(text: str) -> Dict[str, dict]:
    airports: Dict[str, dict] = {}

    header_re = re.compile(r"^([A-Z0-9]{4})\s+\((.*?)\)\s*$")
    pax_re = re.compile(r"^([A-Z0-9]{4})_pax_(\d+)\s+(\d+)\s+/\s+([+-]?\d+)%$")
    cargo_re = re.compile(r"^([A-Z0-9]{4})_cargo_(\d+)\s+(\d+)t\s+/\s+([+-]?\d+)%$")
    sector_re = re.compile(r"^([A-Z0-9]{4})_(\d+)\s+(.+)$")
    airport_dist_re = re.compile(r"([A-Z0-9]{4})/(\d+)nm")

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        header = header_re.match(line)
        if header:
            icao = header.group(1)
            airports.setdefault(icao, {
                "name": header.group(2),
                "pax": {},
                "cargo": {},
                "sectors": {},
            })
            airports[icao]["name"] = header.group(2)
            continue

        pax = pax_re.match(line)
        if pax:
            icao = pax.group(1)
            direction = int(pax.group(2))
            value = int(pax.group(3))
            percent = parse_percent(pax.group(4) + "%")
            airports.setdefault(icao, {"name": "", "pax": {}, "cargo": {}, "sectors": {}})
            airports[icao]["pax"][direction] = {"value": value, "percent": percent}
            continue

        cargo = cargo_re.match(line)
        if cargo:
            icao = cargo.group(1)
            direction = int(cargo.group(2))
            value = int(cargo.group(3))
            percent = parse_percent(cargo.group(4) + "%")
            airports.setdefault(icao, {"name": "", "pax": {}, "cargo": {}, "sectors": {}})
            airports[icao]["cargo"][direction] = {"value": value, "percent": percent}
            continue

        sector = sector_re.match(line)
        if sector:
            icao = sector.group(1)
            direction = int(sector.group(2))
            rest = sector.group(3)

            airports.setdefault(icao, {"name": "", "pax": {}, "cargo": {}, "sectors": {}})
            airports[icao]["sectors"][direction] = [
                (code, int(dist))
                for code, dist in airport_dist_re.findall(rest)
            ]

    return airports


# =========================
# СОРТУВАННЯ НАПРЯМКІВ
# =========================

def sorted_high_demand_directions(airport_data: dict, mode: str) -> List[Tuple[int, int, int]]:
    rows = []
    for direction, info in airport_data.get(mode, {}).items():
        rows.append((direction, info["percent"], info["value"]))
    rows.sort(key=lambda x: (x[1], x[2]), reverse=True)
    return rows


def sorted_low_demand_directions(airport_data: dict, mode: str) -> List[Tuple[int, int, int]]:
    rows = []
    for direction, info in airport_data.get(mode, {}).items():
        rows.append((direction, info["percent"], info["value"]))
    rows.sort(key=lambda x: (x[1], x[2]))
    return rows


# =========================
# OUTBOUND
# =========================

def choose_outbound_destination(
    origin: str,
    airports: Dict[str, dict],
    mode: str,
    max_distance_nm: int = MAX_DISTANCE_NM
) -> Optional[dict]:

    origin_data = airports.get(origin)
    if not origin_data:
        return None

    for direction, origin_percent, origin_value in sorted_high_demand_directions(origin_data, mode):

        if REQUIRE_ORIGIN_NON_NEGATIVE and origin_percent < 0:
            continue

        sector = origin_data.get("sectors", {}).get(direction, [])
        candidates = [
            (code, dist)
            for code, dist in sector
            if dist <= max_distance_nm and code in airports
        ]

        if not candidates:
            continue

        reverse_dir = REVERSE_DIRECTION.get(direction)
        if reverse_dir is None:
            continue

        scored = []

        for code, dist in candidates:
            reverse_info = airports.get(code, {}).get(mode, {}).get(reverse_dir)

            if not reverse_info:
                continue

            reverse_percent = reverse_info["percent"]
            reverse_value = reverse_info["value"]

            if REQUIRE_TARGET_NON_POSITIVE and reverse_percent > 0:
                continue

            amount = recommended_amount(origin_value, origin_percent)

            if amount < min_amount_for_mode(mode):
                continue

            scored.append({
                "code": code,
                "distance": dist,
                "reverse_dir": reverse_dir,
                "reverse_percent": reverse_percent,
                "reverse_value": reverse_value,
                "origin_dir": direction,
                "origin_percent": origin_percent,
                "origin_value": origin_value,
                "amount": amount,
            })

        if not scored:
            continue

        scored.sort(key=lambda x: (x["reverse_percent"], x["reverse_value"], x["distance"]))
        return scored[0]

    return None


# =========================
# INBOUND
# =========================

def choose_inbound_source(
    destination: str,
    airports: Dict[str, dict],
    mode: str,
    max_distance_nm: int = MAX_DISTANCE_NM
) -> Optional[dict]:

    dest_data = airports.get(destination)
    if not dest_data:
        return None

    for direction, dest_percent, dest_value in sorted_low_demand_directions(dest_data, mode):

        if dest_percent >= 0:
            continue

        sector = dest_data.get("sectors", {}).get(direction, [])

        candidates = [
            (code, dist)
            for code, dist in sector
            if dist <= max_distance_nm and code in airports
        ]

        if not candidates:
            continue

        reverse_dir = REVERSE_DIRECTION.get(direction)
        if reverse_dir is None:
            continue

        scored = []

        for code, dist in candidates:
            source_info = airports.get(code, {}).get(mode, {}).get(reverse_dir)

            if not source_info:
                continue

            source_percent = source_info["percent"]
            source_value = source_info["value"]

            amount = inbound_amount(source_value, dest_value)

            if amount < min_amount_for_mode(mode):
                continue

            scored.append({
                "code": code,
                "distance": dist,
                "dest_dir": direction,
                "dest_percent": dest_percent,
                "dest_value": dest_value,
                "source_dir": reverse_dir,
                "source_percent": source_percent,
                "source_value": source_value,
                "amount": amount,
            })

        if not scored:
            continue

        scored.sort(key=lambda x: (x["source_percent"], x["source_value"], -x["distance"]), reverse=True)
        return scored[0]

    return None


# =========================
# ФОРМАТ ДЕТАЛЬНИХ РЯДКІВ
# =========================

def format_outbound_line(origin: str, mode: str, result: Optional[dict]) -> str:
    if not result:
        return f"out {mode} {origin}-NONE"

    code = result["code"]
    dist = result["distance"]
    amount_text = format_amount(mode, result["amount"])

    return (
        f"out {mode} {origin}-{code} ({dist}nm) {amount_text} | "
        f"{origin}_{mode}_{result['origin_dir']} "
        f"{result['origin_value']} / {result['origin_percent']:+d}% | "
        f"{code}_{mode}_{result['reverse_dir']} "
        f"{result['reverse_value']} / {result['reverse_percent']:+d}%"
    )


def format_inbound_line(destination: str, mode: str, result: Optional[dict]) -> str:
    if not result:
        return f"in {mode} NONE-{destination}"

    code = result["code"]
    dist = result["distance"]
    amount_text = format_amount(mode, result["amount"])

    return (
        f"in {mode} {code}-{destination} ({dist}nm) {amount_text} | "
        f"{code}_{mode}_{result['source_dir']} "
        f"{result['source_value']} / {result['source_percent']:+d}% | "
        f"{destination}_{mode}_{result['dest_dir']} "
        f"{result['dest_value']} / {result['dest_percent']:+d}%"
    )


# =========================
# ТОПИ
# =========================

def make_records_for_tops(airports: Dict[str, dict]) -> Tuple[List[dict], List[dict]]:
    outbound_records = []
    inbound_records = []

    uk_airports = sorted([code for code in airports if code.startswith("UK")])

    for icao in uk_airports:
        for mode in ["pax", "cargo"]:
            out_res = choose_outbound_destination(icao, airports, mode)
            if out_res:
                outbound_records.append({
                    "direction": "out",
                    "mode": mode,
                    "origin": icao,
                    "dest": out_res["code"],
                    "distance": out_res["distance"],
                    "amount": out_res["amount"],
                    "local": is_uk(icao) and is_uk(out_res["code"]),
                })

            in_res = choose_inbound_source(icao, airports, mode)
            if in_res:
                inbound_records.append({
                    "direction": "in",
                    "mode": mode,
                    "origin": in_res["code"],
                    "dest": icao,
                    "distance": in_res["distance"],
                    "amount": in_res["amount"],
                    "local": is_uk(in_res["code"]) and is_uk(icao),
                })

    return outbound_records, inbound_records


def unique_route_key(record: dict) -> Tuple[str, str, str, str]:
    return (record["direction"], record["mode"], record["origin"], record["dest"])


def sort_top_records(records: List[dict], shortest: bool = False) -> List[dict]:
    if shortest:
        return sorted(records, key=lambda x: (x["distance"], -x["amount"]))
    return sorted(records, key=lambda x: (x["amount"], -x["distance"]), reverse=True)


def filter_records(
    records: List[dict],
    *,
    mode: Optional[str] = None,
    local: Optional[bool] = None
) -> List[dict]:
    result = []
    seen_routes = set()

    for r in records:
        if mode is not None and r["mode"] != mode:
            continue
        if local is not None and r["local"] != local:
            continue

        key = unique_route_key(r)
        if key in seen_routes:
            continue
        seen_routes.add(key)
        result.append(r)

    return result


def airport_no_repeat_key(record: dict, top_direction: str) -> str:
    """
    Для міжнародного вильоту не повторюємо destination.
    Для міжнародного прильоту не повторюємо origin.
    Для локальних топів беремо пару route як route-key, але також намагаємось
    не повторювати другий аеропорт для більшої різноманітності.
    """
    if top_direction == "out":
        return record["dest"]
    return record["origin"]


def pick_ranked(
    records: List[dict],
    count: int,
    *,
    top_direction: str,
    used_airports: Optional[set] = None,
    mode: Optional[str] = None,
    local: Optional[bool] = None,
    exclude_routes: Optional[set] = None
) -> List[dict]:
    if used_airports is None:
        used_airports = set()
    if exclude_routes is None:
        exclude_routes = set()

    candidates = sort_top_records(filter_records(records, mode=mode, local=local))

    picked = []
    for r in candidates:
        route_key = unique_route_key(r)
        if route_key in exclude_routes:
            continue

        airport_key = airport_no_repeat_key(r, top_direction)
        if airport_key in used_airports:
            continue

        picked.append(r)
        used_airports.add(airport_key)
        exclude_routes.add(route_key)

        if len(picked) >= count:
            break

    return picked


def pick_international_top_with_cargo(records: List[dict], *, top_direction: str) -> List[dict]:
    """
    ТОП-5 міжнародних:
    - мінімум 1 cargo
    - інші 4 — найсильніші будь-якого типу
    - без повтору другого аеропорту в межах блоку
    """
    used_airports = set()
    used_routes = set()
    result = []

    # Спершу обов'язково один cargo
    result += pick_ranked(
        records,
        1,
        top_direction=top_direction,
        used_airports=used_airports,
        mode="cargo",
        local=False,
        exclude_routes=used_routes
    )

    # Потім добираємо до 5 будь-якими міжнародними рейсами
    candidates = sort_top_records(filter_records(records, local=False))
    for r in candidates:
        if len(result) >= 5:
            break

        route_key = unique_route_key(r)
        if route_key in used_routes:
            continue

        airport_key = airport_no_repeat_key(r, top_direction)
        if airport_key in used_airports:
            continue

        result.append(r)
        used_routes.add(route_key)
        used_airports.add(airport_key)

    return result


def pick_domestic_top(records: List[dict], *, mode: str, count: int = 5) -> List[dict]:
    """
    ТОП-5 місцевих по Україні.
    Беремо і out, і in records, бо обидва типи можуть давати гарні локальні маршрути.
    Без дублю route та з обмеженням повтору другого аеропорту, якщо можливо.
    """
    candidates = sort_top_records(filter_records(records, mode=mode, local=True))

    result = []
    used_routes = set()
    used_airports = set()

    for r in candidates:
        route_key = unique_route_key(r)
        if route_key in used_routes:
            continue

        # Для out другий аеропорт dest, для in другий аеропорт origin
        airport_key = airport_no_repeat_key(r, "out" if r["direction"] == "out" else "in")

        # Спершу намагаємось без повтору другого аеропорту
        if airport_key in used_airports:
            continue

        result.append(r)
        used_routes.add(route_key)
        used_airports.add(airport_key)

        if len(result) >= count:
            return result

    # Якщо не набрали 5, добираємо вже без суворого фільтра по airport_key
    for r in candidates:
        if len(result) >= count:
            break

        route_key = unique_route_key(r)
        if route_key in used_routes:
            continue

        result.append(r)
        used_routes.add(route_key)

    return result


def format_top_out(record: dict) -> str:
    amount = format_top_amount(record["mode"], record["amount"])
    icon = icon_for_mode(record["mode"])
    return f"{icon} з {code_with_flag(record['origin'])} до {code_with_flag(record['dest'])} {amount} ({record['distance']}nm)"


def format_top_in(record: dict) -> str:
    amount = format_top_amount(record["mode"], record["amount"])
    icon = icon_for_mode(record["mode"])
    return f"{icon} {amount} з {code_with_flag(record['origin'])} до {code_with_flag(record['dest'])} ({record['distance']}nm)"


def format_top_record(record: dict) -> str:
    if record["direction"] == "in":
        return format_top_in(record)
    return format_top_out(record)


def build_top_sections(outbound_records: List[dict], inbound_records: List[dict]) -> List[str]:
    lines = []

    top_int_out = pick_international_top_with_cargo(outbound_records, top_direction="out")
    lines.append("ТОП-5 міжнародних на виліт")
    if top_int_out:
        for r in top_int_out:
            lines.append(format_top_out(r))
    else:
        lines.append("NONE")
    lines.append("")

    top_int_in = pick_international_top_with_cargo(inbound_records, top_direction="in")
    lines.append("ТОП-5 міжнародних на приліт")
    if top_int_in:
        for r in top_int_in:
            lines.append(format_top_in(r))
    else:
        lines.append("NONE")
    lines.append("")

    domestic_all = outbound_records + inbound_records

    top_domestic_pax = pick_domestic_top(domestic_all, mode="pax", count=5)
    lines.append("ТОП-5 місцевих пасажирських")
    if top_domestic_pax:
        for r in top_domestic_pax:
            lines.append(format_top_record(r))
    else:
        lines.append("NONE")
    lines.append("")

    top_domestic_cargo = pick_domestic_top(domestic_all, mode="cargo", count=5)
    lines.append("ТОП-5 місцевих карго")
    if top_domestic_cargo:
        for r in top_domestic_cargo:
            lines.append(format_top_record(r))
    else:
        lines.append("NONE")
    lines.append("")

    return lines


# =========================
# ОСНОВНИЙ OUTPUT
# =========================

def build_output(airports: Dict[str, dict]) -> str:
    uk_airports = sorted([code for code in airports if code.startswith("UK")])

    outbound_records, inbound_records = make_records_for_tops(airports)

    lines = []
    lines.append("Newsky charter recommendations")
    lines.append(f"Total UK airports: {len(uk_airports)}")
    lines.append(f"Max distance: {MAX_DISTANCE_NM}nm")
    lines.append(f"Minimum pax amount: {MIN_PAX_AMOUNT}")
    lines.append(f"Minimum cargo amount: {MIN_CARGO_AMOUNT}t")
    lines.append(f"Display cap pax: >{MAX_DISPLAY_PAX} pax")
    lines.append(f"Display cap cargo: >{MAX_DISPLAY_CARGO}t")
    lines.append("")
    lines.append("Outbound filters:")
    lines.append("- origin demand percent must be >= 0%")
    lines.append("- target reverse demand percent must be <= 0%")
    lines.append("")
    lines.append("Outbound formula:")
    lines.append(f"- shown amount = round(origin value / {AMOUNT_DIVISOR} * (1 + origin percent / 100))")
    lines.append("")
    lines.append("Inbound logic:")
    lines.append("- find weakest negative outbound direction from UK airport")
    lines.append("- find airport in that sector with strongest outbound demand back to UK airport")
    lines.append(f"- inbound shown amount = min(round(source value / {INBOUND_AMOUNT_DIVISOR}), round(destination value / {INBOUND_DESTINATION_CAP_DIVISOR}))")
    lines.append("")
    lines.extend(build_top_sections(outbound_records, inbound_records))
    lines.append("------------------------------------------------------------")
    lines.append("")

    for icao in uk_airports:
        name = airports[icao].get("name", "")
        title = f"{icao} ({name})" if name else icao

        out_pax = choose_outbound_destination(icao, airports, "pax")
        out_cargo = choose_outbound_destination(icao, airports, "cargo")
        in_pax = choose_inbound_source(icao, airports, "pax")
        in_cargo = choose_inbound_source(icao, airports, "cargo")

        lines.append(title)
        lines.append(format_outbound_line(icao, "pax", out_pax))
        lines.append(format_outbound_line(icao, "cargo", out_cargo))
        lines.append(format_inbound_line(icao, "pax", in_pax))
        lines.append(format_inbound_line(icao, "cargo", in_cargo))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(f"Input file not found: {INPUT_FILE}")

    text = INPUT_FILE.read_text(encoding="utf-8")
    airports = parse_report(text)

    output = build_output(airports)
    OUTPUT_FILE.write_text(output, encoding="utf-8")

    print(f"Saved: {OUTPUT_FILE}")
    print(f"Airports parsed: {len(airports)}")
    print(f"UK airports processed: {len([a for a in airports if a.startswith('UK')])}")


if __name__ == "__main__":
    main()
