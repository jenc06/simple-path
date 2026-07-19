from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, NotRequired, Sequence, TypedDict


FORMAT_INVALID_CAP = 40
CROSS_PASS_MISMATCH_PENALTY = 25
CROSS_PASS_MATCH_BONUS = 10
DEFAULT_REGION_CLARITY = 1.0

HIGH_CONFIDENCE_MIN = 80
MEDIUM_CONFIDENCE_MIN = 50

ConfidenceTier = Literal["High", "Medium", "Low"]


class FieldConfidenceInput(TypedDict):
    ocr_score: float
    format_valid: bool
    cross_pass_match: bool | None
    region_clarity: NotRequired[float]


@dataclass(frozen=True)
class FieldConfidenceResult:
    confidence_percent: int
    tier: ConfidenceTier
    requires_confirmation: bool


@dataclass(frozen=True)
class AccuracyBucket:
    bucket: str
    total: int
    correct: int
    accuracy_percent: float | None


@dataclass(frozen=True)
class CalibrationSummary:
    average_confidence_correct: float | None
    average_confidence_incorrect: float | None
    buckets: tuple[AccuracyBucket, ...]
    readable_summary: str


Prediction = tuple[int | float, bool]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def confidence_tier(confidence_percent: int) -> ConfidenceTier:
    if confidence_percent >= HIGH_CONFIDENCE_MIN:
        return "High"
    if confidence_percent >= MEDIUM_CONFIDENCE_MIN:
        return "Medium"
    return "Low"


def calculate_field_confidence(field_data: FieldConfidenceInput) -> FieldConfidenceResult:
    """Compute deterministic field confidence from measurable extraction signals."""
    ocr_score = clamp(float(field_data["ocr_score"]), 0.0, 1.0)
    format_valid = bool(field_data["format_valid"])
    cross_pass_match = field_data.get("cross_pass_match")
    region_clarity = clamp(float(field_data.get("region_clarity", DEFAULT_REGION_CLARITY)), 0.0, 1.0)

    score = ocr_score * 100

    if cross_pass_match is False:
        score -= CROSS_PASS_MISMATCH_PENALTY
    elif cross_pass_match is True:
        score += CROSS_PASS_MATCH_BONUS

    if not format_valid:
        score = min(score, FORMAT_INVALID_CAP)

    score *= region_clarity
    confidence_percent = int(round(clamp(score, 0, 100)))
    tier = confidence_tier(confidence_percent)

    return FieldConfidenceResult(
        confidence_percent=confidence_percent,
        tier=tier,
        requires_confirmation=tier == "Low",
    )


def average(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def bucket_label(low: int, high: int) -> str:
    return f"{low}-{high}%"


def validate_calibration(
    predictions: Iterable[Prediction],
    gold_labels: Iterable[bool] | None = None,
) -> CalibrationSummary:
    """Summarize whether confidence percentages are calibrated against gold correctness labels.

    Pass either:
    - predictions as (field_confidence_percent, was_actually_correct) tuples, or
    - predictions as confidence percentages and gold_labels as the matching booleans.
    """
    if gold_labels is None:
        rows = [(float(conf), bool(correct)) for conf, correct in predictions]
    else:
        rows = [(float(conf), bool(correct)) for conf, correct in zip(predictions, gold_labels)]

    correct_confidences = [clamp(conf, 0, 100) for conf, correct in rows if correct]
    incorrect_confidences = [clamp(conf, 0, 100) for conf, correct in rows if not correct]

    bucket_ranges = ((80, 100), (50, 79), (0, 49))
    buckets: list[AccuracyBucket] = []
    for low, high in bucket_ranges:
        bucket_rows = [
            (conf, correct)
            for conf, correct in rows
            if low <= clamp(conf, 0, 100) <= high
        ]
        correct_count = sum(1 for _, correct in bucket_rows if correct)
        total = len(bucket_rows)
        accuracy = (correct_count / total) * 100 if total else None
        buckets.append(
            AccuracyBucket(
                bucket=bucket_label(low, high),
                total=total,
                correct=correct_count,
                accuracy_percent=round(accuracy, 1) if accuracy is not None else None,
            )
        )

    avg_correct = average(correct_confidences)
    avg_incorrect = average(incorrect_confidences)
    lines = [
        "Confidence calibration summary",
        f"Average confidence for actually correct fields: {avg_correct:.1f}%"
        if avg_correct is not None
        else "Average confidence for actually correct fields: n/a",
        f"Average confidence for actually incorrect fields: {avg_incorrect:.1f}%"
        if avg_incorrect is not None
        else "Average confidence for actually incorrect fields: n/a",
        "Bucketed accuracy:",
    ]
    for bucket in buckets:
        if bucket.total == 0:
            lines.append(f"- {bucket.bucket}: no fields")
        else:
            lines.append(
                f"- {bucket.bucket}: {bucket.accuracy_percent:.1f}% actually correct "
                f"({bucket.correct}/{bucket.total})"
            )

    return CalibrationSummary(
        average_confidence_correct=round(avg_correct, 1) if avg_correct is not None else None,
        average_confidence_incorrect=round(avg_incorrect, 1) if avg_incorrect is not None else None,
        buckets=tuple(buckets),
        readable_summary="\n".join(lines),
    )
