"""Unit tests for ocr_vision_supabase parsers (no Hermes/OpenRouter)."""
from __future__ import annotations

import json
import unittest

from ocr_vision_supabase import (
    parse_json_object,
    parse_vision_tool_result,
    vision_fields_to_ocr,
)


class TestVisionSupabaseParse(unittest.TestCase):
    def test_parse_json_object(self):
        raw = 'Here is data {"name": "Абрака", "cost": 2}'
        parsed = parse_json_object(raw)
        self.assertEqual(parsed["name"], "Абрака")
        self.assertEqual(parsed["cost"], 2)

    def test_parse_vision_envelope(self):
        envelope = {
            "success": True,
            "analysis": '[note] {"name": "Стейк", "cost": 3, "attack": 4, "health": 6}',
        }
        ocr, err = parse_vision_tool_result(envelope)
        self.assertIsNone(err)
        self.assertEqual(ocr["name"], "Стейк")
        self.assertEqual(ocr["cost"], 3)

    def test_parse_vision_json_string(self):
        envelope = json.dumps({
            "success": True,
            "analysis": '{"name": "Школа", "description": "Строение"}',
        })
        ocr, err = parse_vision_tool_result(envelope)
        self.assertIsNone(err)
        self.assertEqual(ocr["name"], "Школа")

    def test_vision_fields_to_ocr(self):
        ocr = vision_fields_to_ocr({
            "name": "X",
            "cost": 1,
            "attack": 2,
            "health": 3,
            "card_type": "creature",
            "land_type": "swamp",
        })
        self.assertEqual(ocr["card_type"], "creature")
        self.assertEqual(ocr["land_type"], "swamp")


if __name__ == "__main__":
    unittest.main()
