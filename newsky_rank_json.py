import re
import json
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright


NEWSKY_URL = "https://newsky.app/airlines"

MY_ICAO = "UKL"
MY_NAME_KEYWORDS = [
    "Ukraine Classic",
    "Ukraine Classicy",
]

TOP_TARGET = 10
OUTPUT_FILE = "newsky-rank.json"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def plural_flights_ua(n: int) -> str:
    n_abs = abs(n)

    if 11 <= n_abs % 100 <= 14:
        return "польотів"

    last = n_abs % 10

    if last == 1:
        return "політ"
    if 2 <= last <= 4:
        return "польоти"
    return "польотів"


def parse_airline_text(text: str):
    """
    Очікуваний формат NewSky:
    Ukraine Classic UKL 9.25 very active flight_takeoff 409 people_alt 49 how_to_reg 20 (41%) UKKK ...
    """

    text = clean(text)

    flights_match = re.search(r"flight_takeoff\s+(\d+)", text)
    pilots_match = re.search(r"people_alt\s+(\d+)", text)
    active_match = re.search(r"how_to_reg\s+(\d+)", text)

    if not flights_match:
        return None

    flights = int(flights_match.group(1))
    pilots = int(pilots_match.group(1)) if pilots_match else None
    active = int(active_match.group(1)) if active_match else None

    before_stats = clean(text.split("flight_takeoff")[0])

    match = re.match(
        r"^(?P<name>.+?)\s+(?P<icao>[A-Z0-9]{3})\s+(?P<rating>N/A|\d+(?:\.\d+)?)\s+(?P<status>.+?)$",
        before_stats,
        re.IGNORECASE,
    )

    if match:
        name = clean(match.group("name"))
        icao = clean(match.group("icao")).upper()
        rating = clean(match.group("rating"))
        status = clean(match.group("status"))
    else:
        icao_match = re.search(r"\b([A-Z0-9]{3})\b", before_stats)
        icao = icao_match.group(1).upper() if icao_match else ""
        name = before_stats
        rating = ""
        status = ""

    bad_names = {
        "active",
        "very active",
        "hyperactive",
        "inactive",
    }

    if name.lower() in bad_names:
        return None

    return {
        "name": name,
        "icao": icao,
        "rating": rating,
        "status": status,
        "flights": flights,
        "pilots": pilots,
        "activePilots": active,
        "raw": text,
    }


def extract_visible_airlines(page):
    raw_items = page.evaluate(
        """
        () => {
            function clean(t) {
                return (t || '').replace(/\\s+/g, ' ').trim();
            }

            function isVisible(el) {
                const r = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);

                return (
                    r.width > 0 &&
                    r.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none'
                );
            }

            const elements = Array.from(
                document.querySelectorAll('div, a, li, article, section')
            );

            const result = [];

            for (const el of elements) {
                if (!isVisible(el)) continue;

                const r = el.getBoundingClientRect();
                const text = clean(el.innerText || el.textContent);

                if (!text) continue;
                if (!text.includes('flight_takeoff')) continue;
                if (!text.includes('people_alt')) continue;
                if (!text.includes('how_to_reg')) continue;

                if (r.width < 450) continue;
                if (r.height < 35 || r.height > 260) continue;

                if (!/[A-Z0-9]{3}\\s+(N\\/A|\\d+(\\.\\d+)?)/.test(text)) continue;

                result.push({
                    top: r.top + window.scrollY,
                    text: text
                });
            }

            return result;
        }
        """
    )

    parsed = []

    for item in raw_items:
        airline = parse_airline_text(item["text"])

        if not airline:
            continue

        airline["top"] = item["top"]
        parsed.append(airline)

    return parsed


def collect_airlines():
    all_by_icao = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            slow_mo=80,
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
        )

        context = browser.new_context(
            viewport={"width": 1400, "height": 950},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        page = context.new_page()

        print("Відкриваю NewSky...")
        page.goto(NEWSKY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)

        print()
        print("Залогінься вручну у відкритому браузері.")
        print("Коли побачиш список авіакомпаній NewSky — повернись у PowerShell.")
        input("Натисни Enter тут, коли сайт уже відкритий і ти залогінений...")

        page.goto(NEWSKY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(8000)

        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)

        print("Збираю авіакомпанії...")

        for step in range(35):
            visible_airlines = extract_visible_airlines(page)

            for airline in visible_airlines:
                key = airline["icao"] or airline["name"].lower()

                if key not in all_by_icao:
                    all_by_icao[key] = airline
                else:
                    old = all_by_icao[key]

                    old_top = old.get("top", 999999999)
                    new_top = airline.get("top", 999999999)

                    # Залишаємо той запис, який вище на сторінці.
                    # Це важливо для реального рейтингу NewSky, особливо коли рейсів однаково.
                    if new_top < old_top:
                        all_by_icao[key] = airline
                    elif abs(new_top - old_top) < 3 and len(airline["raw"]) > len(old["raw"]):
                        airline["top"] = old_top
                        all_by_icao[key] = airline

            page.mouse.wheel(0, 750)
            page.wait_for_timeout(600)

        browser.close()

    airlines = list(all_by_icao.values())

    # ВАЖЛИВО:
    # Не сортуємо по flights.
    # Реальний рейтинг NewSky = порядок карток на сторінці.
    airlines.sort(key=lambda x: x.get("top", 999999999))

    for index, airline in enumerate(airlines, start=1):
        airline["rank"] = index

    return airlines


def find_my_airline(airlines):
    for index, airline in enumerate(airlines):
        haystack = f"{airline['name']} {airline['icao']}".lower()

        if airline["icao"] == MY_ICAO:
            return index

        if any(keyword.lower() in haystack for keyword in MY_NAME_KEYWORDS):
            return index

    return None


def build_result_json(airlines):
    my_index = find_my_airline(airlines)

    if my_index is None:
        raise RuntimeError(f"Не знайшов авіакомпанію {MY_ICAO}")

    me = airlines[my_index]

    above = airlines[my_index - 1] if my_index > 0 else None
    below = airlines[my_index + 1] if my_index + 1 < len(airlines) else None

    top_target_airline = airlines[TOP_TARGET - 1] if len(airlines) >= TOP_TARGET else None

    diff_above = above["flights"] - me["flights"] if above else 0
    diff_below = me["flights"] - below["flights"] if below else 0

    if top_target_airline:
        needed_for_top_target = max(
            0,
            top_target_airline["flights"] + 1 - me["flights"],
        )
    else:
        needed_for_top_target = 0

    summary_lines = []

    summary_lines.append(
        f"Ми #{me['rank']} у ТОП NewSky — "
        f"{me['flights']} {plural_flights_ua(me['flights'])}"
    )

    if above:
        summary_lines.append(
            f"Відстаєм від #{above['rank']} \"{above['name']}\" "
            f"на {diff_above} {plural_flights_ua(diff_above)}."
        )
    else:
        summary_lines.append("Ми вже #1 у ТОП NewSky.")

    if below:
        summary_lines.append(
            f"Випереджаєм #{below['rank']} \"{below['name']}\" "
            f"на {diff_below} {plural_flights_ua(diff_below)}."
        )

    if me["rank"] <= TOP_TARGET:
        summary_lines.append(f"Ми вже у ТОП-{TOP_TARGET} NewSky.")
    elif top_target_airline:
        summary_lines.append(
            f"Для ТОП-{TOP_TARGET} треба на {needed_for_top_target} "
            f"{plural_flights_ua(needed_for_top_target)} більше."
        )

    summary_text = "\n".join(summary_lines)

    result = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": NEWSKY_URL,
        "airline": {
            "name": me["name"],
            "icao": me["icao"],
            "rank": me["rank"],
            "flights": me["flights"],
            "pilots": me["pilots"],
            "activePilots": me["activePilots"],
            "rating": me["rating"],
            "status": me["status"],
        },
        "above": None if not above else {
            "name": above["name"],
            "icao": above["icao"],
            "rank": above["rank"],
            "flights": above["flights"],
            "difference": diff_above,
        },
        "below": None if not below else {
            "name": below["name"],
            "icao": below["icao"],
            "rank": below["rank"],
            "flights": below["flights"],
            "difference": diff_below,
        },
        "topTarget": None if not top_target_airline else {
            "targetRank": TOP_TARGET,
            "targetAirlineName": top_target_airline["name"],
            "targetAirlineIcao": top_target_airline["icao"],
            "targetAirlineFlights": top_target_airline["flights"],
            "neededFlights": needed_for_top_target,
            "rule": f"потрібно мати на 1 політ більше, ніж поточне #{TOP_TARGET}",
        },
        "summaryText": summary_text,
        "top20": [
            {
                "rank": airline["rank"],
                "name": airline["name"],
                "icao": airline["icao"],
                "flights": airline["flights"],
                "pilots": airline["pilots"],
                "activePilots": airline["activePilots"],
                "rating": airline["rating"],
                "status": airline["status"],
            }
            for airline in airlines[:20]
        ],
    }

    return result


def main():
    airlines = collect_airlines()

    print(f"Зібрано авіакомпаній: {len(airlines)}")

    result = build_result_json(airlines)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 80)
    print(result["summaryText"])
    print("=" * 80)
    print()
    print(f"JSON збережено у файл: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()