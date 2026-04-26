from playwright.sync_api import sync_playwright
from pathlib import Path
from datetime import datetime
import json

AIRPORTS = [
    "UKBB", "UKCC", "UKCM", "UKCW", 
    "UKDD", "UKDE", "UKDR", "UKFF", 
    "UKHH", "UKHP", "UKHS", "UKKE", "UKKG",
    "UKKK", "UKKM", "UKKV", "UKLH", "UKLI",
    "UKLL", "UKLN", "UKLR", "UKLT", "UKLU",
    "UKOH", "UKON", "UKOO", "UKWW", 
    "CYYZ", "DTMB", "EBLG", "EBOS", "EDDF",
    "EDDH", "EDDK", "EDDL", "EDDM", "EDDN",
    "EDDT", "EDDV", "EDFH", "EDHL", "EDLW",
    "EDNY", "EFHK", "EFKI", "EFKT", "EFKU",
    "EFTU", "EGGW", "EGKK", "EGLL", "EGPF",
    "EHAM", "EHBK", "EHRD", "EPKT", "EPLB",
    "EPWA", "EPWR", "ESSA", "EYVI", "GMTT",
    "HECA", "HEGN", "HEMA", "HESH", 
    "KJFK", "LATI", "LBBG", "LBSF", "LBWN",
    "LCLK", "LDDU", "LDPL", "LDSP", "LDZA",
    "LEAL", "LEBL", "LEGE", "LEVC", "LEZG",
    "LFLY", "LFPG", "LGAV",
    "LGAX", "LGIR", "LGKR", "LGRP", "LGRX",
    "LGSK", "LGTP", "LGTS", "LHBP", "LHDC",
    "LIMC", "LIPH", "LIPR", "LIRF", "LIRN",
    "LKKV", "LKMT", "LKPR", "LLBG", "LOWS",
    "LPPT", "LRBS", "LROP", "LSGG", "LSZH",
    "LTAI", "LTBA", "LTBJ", "LTBS", "LTCG",
    "LTFE", "LTFJ", "LTFM", "LUKK", "LWSK",
    "LYBE", "LYPG", "LYTV", "LZIB", "LZTT",
    "MDLR", "MMUN", "OEGS", "OIIE", "OIII",
    "OJAI", "OLBA", "OMDB", "OMSJ", "EBBR",
    "UAAA", "UBBB", "UDYZ", "LOWW",
    "UGSB", "UGTB", "EBLG", "LEMD", 
    "UTTT", "EDDP", "ELLX", "EGNX",
    "VHHH", "VIAR", "VIDP", "VTBS", "ZBAA"
]

BASE_DIR = Path(r"C:\Users\maten\Downloads")
OUTPUT_FILE = BASE_DIR / "newsky-airports.txt"
STATE_FILE = BASE_DIR / "newsky-state.json"


def fetch_airports(page):
    results = []
    failed = []

    for icao in AIRPORTS:
        print(f"Fetching {icao} ...")

        try:
            data = page.evaluate(
                """async (icao) => {
                    const res = await fetch(`/api/airport/${icao}`, {
                        method: "GET",
                        credentials: "include"
                    });

                    const text = await res.text();

                    return {
                        ok: res.ok,
                        status: res.status,
                        text: text
                    };
                }""",
                icao
            )

            if data["ok"]:
                parsed = json.loads(data["text"])
                results.append(json.dumps(parsed, ensure_ascii=False))
                print(f"Got JSON for {icao}")
            else:
                failed.append((icao, data["status"]))
                print(f"Failed {icao}: HTTP {data['status']}")
                print(data["text"][:200])

        except Exception as e:
            failed.append((icao, str(e)))
            print(f"Error for {icao}: {e}")

    updated_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    content = f"UPDATED: {updated_str}\n\n" + "\n\n---\n\n".join(results)

    OUTPUT_FILE.write_text(content, encoding="utf-8")

    print(f"\nSaved to: {OUTPUT_FILE}")
    print(f"Updated timestamp: {updated_str}")
    print(f"Success: {len(results)} / {len(AIRPORTS)}")

    if failed:
        print("\nFailed airports:")
        for item in failed:
            print(" -", item[0], item[1])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)

    if STATE_FILE.exists():
        print("Знайшов збережену сесію, використовую її...")
        context = browser.new_context(storage_state=str(STATE_FILE))
        page = context.new_page()
        page.goto("https://newsky.app", wait_until="domcontentloaded")
    else:
        print("Сесію не знайдено.")
        print("Залогінься в браузері вручну, потім повернись сюди і натисни Enter.")
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://newsky.app", wait_until="domcontentloaded")
        input()

        context.storage_state(path=str(STATE_FILE), indexed_db=True)
        print(f"Сесію збережено у: {STATE_FILE}")

    fetch_airports(page)
    browser.close()