"""Regression tests for geographic reverse-sector selection in NewSky charters."""
from pathlib import Path
import unittest

import newsky_charter_with_tops_v4 as charter


ROOT = Path(__file__).resolve().parents[1]


class NewSkySectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.airports = charter.parse_report(
            (ROOT / "newsky-airports-report.txt").read_text(encoding="utf-8")
        )

    def test_reverse_sectors_from_geographic_report(self):
        self.assertEqual(charter.sector_for_route(self.airports, "LZTT", "UKBB"), 90)
        self.assertEqual(charter.sector_for_route(self.airports, "UKBB", "LZTT"), 270)
        self.assertEqual(charter.sector_for_route(self.airports, "EFKI", "UKKK"), 180)
        self.assertEqual(charter.sector_for_route(self.airports, "UKKK", "EFKI"), 0)

    def test_missing_reverse_sector_does_not_invent_one(self):
        self.assertIsNone(charter.sector_for_route(self.airports, "LZTT", "XXXX"))
        self.assertIsNone(charter.sector_for_route({}, "UKBB", "LZTT"))

    def test_original_lztt_case_falls_below_minimum_with_correct_sector(self):
        fixture = {
            "LZTT": {
                "pax": {90: {"value": 172, "percent": 62}},
                "cargo": {},
                "sectors": {90: [("UKBB", 430)]},
            },
            "UKBB": {
                "pax": {270: {"value": 1435, "percent": -40}},
                "cargo": {},
                "sectors": {270: [("LZTT", 430)]},
            },
        }
        self.assertEqual(charter.inbound_amount(172, 1435), 49)
        self.assertIsNone(charter.choose_inbound_source("UKBB", fixture, "pax"))

    def test_all_known_routes_have_geographic_reverse_sectors(self):
        for origin, airport in self.airports.items():
            for direction, members in airport["sectors"].items():
                for dest, distance in members:
                    if distance > charter.MAX_DISTANCE_NM or dest not in self.airports:
                        continue
                    with self.subTest(origin=origin, dest=dest, direction=direction):
                        self.assertIsNotNone(
                            charter.sector_for_route(self.airports, dest, origin)
                        )

    def test_generated_proposals_use_reported_reverse_sectors(self):
        for icao in sorted(code for code in self.airports if code.startswith("UK")):
            for mode in ("pax", "cargo"):
                out = charter.choose_outbound_destination(icao, self.airports, mode)
                if out:
                    self.assertEqual(
                        out["reverse_dir"],
                        charter.sector_for_route(self.airports, out["code"], icao),
                    )
                inbound = charter.choose_inbound_source(icao, self.airports, mode)
                if inbound:
                    self.assertEqual(
                        inbound["source_dir"],
                        charter.sector_for_route(self.airports, inbound["code"], icao),
                    )


if __name__ == "__main__":
    unittest.main()
