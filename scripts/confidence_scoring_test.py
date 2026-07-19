import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from confidence_scoring import (
    FORMAT_INVALID_CAP,
    calculate_field_confidence,
    validate_calibration,
)


class ConfidenceScoringTest(unittest.TestCase):
    def test_perfect_signals_score_high(self):
        result = calculate_field_confidence({
            "ocr_score": 0.95,
            "format_valid": True,
            "cross_pass_match": True,
            "region_clarity": 1.0,
        })

        self.assertEqual(result.confidence_percent, 100)
        self.assertEqual(result.tier, "High")
        self.assertFalse(result.requires_confirmation)

    def test_invalid_format_caps_even_with_good_ocr(self):
        result = calculate_field_confidence({
            "ocr_score": 0.99,
            "format_valid": False,
            "cross_pass_match": True,
            "region_clarity": 1.0,
        })

        self.assertLessEqual(result.confidence_percent, FORMAT_INVALID_CAP)
        self.assertEqual(result.confidence_percent, 40)
        self.assertEqual(result.tier, "Low")

    def test_cross_pass_mismatch_reduces_score(self):
        result = calculate_field_confidence({
            "ocr_score": 0.90,
            "format_valid": True,
            "cross_pass_match": False,
            "region_clarity": 1.0,
        })

        self.assertEqual(result.confidence_percent, 65)
        self.assertEqual(result.tier, "Medium")

    def test_missing_cross_pass_leaves_score_unchanged(self):
        result = calculate_field_confidence({
            "ocr_score": 0.76,
            "format_valid": True,
            "cross_pass_match": None,
            "region_clarity": 1.0,
        })

        self.assertEqual(result.confidence_percent, 76)
        self.assertEqual(result.tier, "Medium")

    def test_low_tier_requires_confirmation(self):
        result = calculate_field_confidence({
            "ocr_score": 0.45,
            "format_valid": True,
            "cross_pass_match": None,
            "region_clarity": 1.0,
        })

        self.assertEqual(result.tier, "Low")
        self.assertTrue(result.requires_confirmation)

    def test_validate_calibration_returns_readable_summary(self):
        summary = validate_calibration([(95, True), (82, True), (65, False), (35, False)])

        self.assertEqual(summary.average_confidence_correct, 88.5)
        self.assertEqual(summary.average_confidence_incorrect, 50.0)
        self.assertIn("Bucketed accuracy", summary.readable_summary)
        self.assertIn("80-100%: 100.0% actually correct", summary.readable_summary)


if __name__ == "__main__":
    unittest.main()
