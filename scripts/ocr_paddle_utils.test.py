"""Unit tests for ocr_paddle_utils (no PaddleOCR required)."""
from __future__ import annotations

import unittest

from ocr_paddle_utils import (
    compare_card_db_ocr,
    name_similar,
    parse_card_from_ocr,
    text_similar,
)


class TestOcrPaddleUtils(unittest.TestCase):
    def test_name_similar(self):
        self.assertTrue(name_similar("Рубленный стейк", "рубленный стейк"))
        self.assertTrue(name_similar("Пси-архитектор", "Пси архитектор"))
        self.assertFalse(name_similar("Школа", "Рубленный стейк"))

    def test_parse_layout_heuristic(self):
        # Simulated paddle boxes: cost top-left, name top, atk/hp bottom, desc middle
        fake = [[
            [[[10, 10], [40, 10], [40, 40], [10, 40]], ("3", 0.95)],
            [[[80, 20], [300, 20], [300, 55], [80, 55]], ("Рубленный стейк", 0.9)],
            [[[50, 200], [280, 200], [280, 260], [50, 260]], ("Наносит 2 урона", 0.85)],
            [[[30, 420], [60, 420], [60, 450], [30, 450]], ("4", 0.92)],
            [[[340, 420], [370, 420], [370, 450], [340, 450]], ("6", 0.91)],
        ]]
        parsed = parse_card_from_ocr(fake, 400, 500)
        self.assertEqual(parsed["cost"], 3)
        self.assertEqual(parsed["attack"], 4)
        self.assertEqual(parsed["health"], 6)
        self.assertIn("стейк", (parsed["name"] or "").lower())
        self.assertIn("урона", (parsed["description"] or "").lower())

    def test_compare_detects_name_mismatch(self):
        db = {
            "name": "Школа",
            "cost": 3,
            "attack": 0,
            "health": 5,
            "description": "Строение",
        }
        ocr = {
            "name": "Рубленный стейк",
            "cost": 3,
            "attack": 4,
            "health": 6,
            "description": "Наносит урон",
            "all_text": "Рубленный стейк 3 4 6",
            "lines": [{"text": "Рубленный стейк"}],
        }
        diffs = compare_card_db_ocr(db, ocr)
        fields = {d["field"] for d in diffs}
        self.assertIn("name", fields)
        self.assertIn("attack", fields)
        self.assertIn("health", fields)

    def test_compare_ok_when_similar(self):
        db = {"name": "Рубленный стейк", "cost": 3, "attack": 4, "health": 6, "description": "x"}
        ocr = {
            "name": "Рубленный стейк",
            "cost": 3,
            "attack": 4,
            "health": 6,
            "description": "x",
            "all_text": "Рубленный стейк",
            "lines": [],
        }
        self.assertEqual(compare_card_db_ocr(db, ocr), [])


if __name__ == "__main__":
    unittest.main()
