#!/usr/bin/env python3
import argparse
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pdfplumber
from PIL import Image

from confidence_scoring import calculate_field_confidence


DOC_TYPES = {
    "application_form",
    "pay_stub",
    "benefit_letter",
    "employment_letter",
    "gig_statement",
}

FIELD_META = {
    "application_form": {
        "person_name": ("Applicant name", "basic"),
        "household_size": ("Household size", "basic"),
        "address": ("Address", "basic"),
        "application_date": ("Application date", "basic"),
    },
    "pay_stub": {
        "source_name": ("Income source", "basic"),
        "person_name": ("Applicant name", "basic"),
        "pay_date": ("Pay date", "basic"),
        "pay_period_start": ("Pay period start", "basic"),
        "pay_period_end": ("Pay period end", "basic"),
        "pay_frequency": ("Pay frequency", "basic"),
        "regular_hours": ("Regular hours", "calculation"),
        "hourly_rate": ("Hourly rate", "calculation"),
        "gross_pay": ("Gross pay", "calculation"),
        "net_pay": ("Net pay", "calculation"),
    },
    "benefit_letter": {
        "source_name": ("Income source", "basic"),
        "person_name": ("Applicant name", "basic"),
        "document_date": ("Letter date", "basic"),
        "monthly_benefit": ("Monthly benefit amount", "calculation"),
        "benefit_frequency": ("Benefit frequency", "basic"),
    },
    "employment_letter": {
        "source_name": ("Income source", "basic"),
        "person_name": ("Applicant name", "basic"),
        "document_date": ("Letter date", "basic"),
        "weekly_hours": ("Weekly hours", "calculation"),
        "hourly_rate": ("Hourly rate", "calculation"),
    },
    "gig_statement": {
        "source_name": ("Income source", "basic"),
        "person_name": ("Applicant name", "basic"),
        "statement_month": ("Statement month", "basic"),
        "gross_receipts": ("Gross receipts", "calculation"),
        "platform_fees": ("Platform fees", "calculation"),
    },
}

SENSITIVE_KEYS = {
    "ssn",
    "social_security_number",
    "bank_account",
    "routing_number",
    "medical_information",
    "immigration_status",
    "disability_status",
    "race",
    "gender",
}

SINGLE_VALUE_KEYS = {
    "person_name",
    "household_size",
    "address",
    "application_date",
}

DATE_KEYS = {"application_date", "pay_date", "pay_period_start", "pay_period_end", "document_date"}
MONTH_KEYS = {"statement_month"}
CURRENCY_KEYS = {
    "hourly_rate",
    "gross_pay",
    "net_pay",
    "monthly_benefit",
    "gross_receipts",
    "platform_fees",
}
NUMBER_KEYS = {"household_size", "regular_hours", "weekly_hours"}
FREQUENCY_KEYS = {"pay_frequency", "benefit_frequency"}


def warn(message):
    return {"message": message}


def percent_bbox(x0, top, x1, bottom, width, height):
    x0 = max(0, min(float(x0), width))
    x1 = max(0, min(float(x1), width))
    top = max(0, min(float(top), height))
    bottom = max(0, min(float(bottom), height))
    if x1 < x0:
        x0, x1 = x1, x0
    if bottom < top:
        top, bottom = bottom, top
    return {
        "x": round((x0 / width) * 100, 2) if width else 0,
        "y": round((top / height) * 100, 2) if height else 0,
        "w": round(((x1 - x0) / width) * 100, 2) if width else 0,
        "h": round(((bottom - top) / height) * 100, 2) if height else 0,
    }


def pad_value_bbox(bbox, x_pad=0.8, y_pad=0.45, h_pad=0.8):
    y = max(0, bbox["y"] - y_pad)
    x = max(0, bbox["x"] - x_pad)
    return {
        "x": round(x, 2),
        "y": round(y, 2),
        "w": round(min(100 - x, bbox["w"] + x_pad * 2), 2),
        "h": round(min(100 - y, bbox["h"] + h_pad), 2),
    }


def is_pdf(path):
    return path.suffix.lower() == ".pdf"


def clean_text(text):
    return re.sub(r"\s+", " ", (text or "").replace("(cid:127)", " ")).strip()


def extract_pdf_text_page(path, page_index):
    blocks = []
    with pdfplumber.open(path) as pdf:
        if page_index >= len(pdf.pages):
            return blocks
        page = pdf.pages[page_index]
        words = []
        for w in page.extract_words() or []:
            text = clean_text(w.get("text", ""))
            if not text or len(text) == 1:
                continue
            x0, x1 = float(w["x0"]), float(w["x1"])
            top, bottom = float(w["top"]), float(w["bottom"])
            if not (0 <= x0 <= page.width and 0 <= x1 <= page.width):
                continue
            if not (0 <= top <= page.height and 0 <= bottom <= page.height):
                continue
            words.append({**w, "text": text})

        lines = {}
        for w in words:
            key = round(float(w["top"]) / 4) * 4
            lines.setdefault(key, []).append(w)

        for _, line_words in sorted(lines.items()):
            line_words = sorted(line_words, key=lambda item: item["x0"])
            text = clean_text(" ".join(w["text"] for w in line_words))
            if not text:
                continue
            x0 = min(float(w["x0"]) for w in line_words)
            x1 = max(float(w["x1"]) for w in line_words)
            top = min(float(w["top"]) for w in line_words)
            bottom = max(float(w["bottom"]) for w in line_words)
            blocks.append({
                "text": text,
                "page": page_index + 1,
                "bbox": percent_bbox(x0, top, x1, bottom, page.width, page.height),
                "words": [
                    {
                        "text": w["text"],
                        "bbox": percent_bbox(
                            float(w["x0"]),
                            float(w["top"]),
                            float(w["x1"]),
                            float(w["bottom"]),
                            page.width,
                            page.height,
                        ),
                    }
                    for w in line_words
                ],
                "source": "pdf_text",
            })
    return blocks


def render_pdf_page(path, page_index, tmpdir):
    prefix = str(Path(tmpdir) / f"page_{page_index + 1}")
    subprocess.run(
        ["pdftoppm", "-f", str(page_index + 1), "-l", str(page_index + 1), "-r", "120", "-png", str(path), prefix],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    rendered = Path(f"{prefix}-{page_index + 1}.png")
    if not rendered.exists():
        matches = sorted(Path(tmpdir).glob(f"page_{page_index + 1}-*.png"))
        if not matches:
            raise FileNotFoundError("pdftoppm did not create a page image")
        rendered = matches[0]
    return rendered


def image_data_url(image_path, max_width=900):
    with Image.open(image_path) as image:
        image = image.convert("RGB")
        if image.width > max_width:
            ratio = max_width / float(image.width)
            next_size = (max_width, max(1, int(image.height * ratio)))
            image = image.resize(next_size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def preview_pages(path, page_numbers):
    pages = {}
    wanted = sorted({int(page) for page in page_numbers if int(page) > 0})
    if not wanted:
        wanted = [1]
    with tempfile.TemporaryDirectory(prefix="rentsmooth_preview_") as tmpdir:
        if is_pdf(path):
            total = page_count(path)
            for page in wanted:
                if page > total:
                    continue
                image_path = render_pdf_page(path, page - 1, tmpdir)
                pages[str(page)] = image_data_url(image_path)
        else:
            pages["1"] = image_data_url(path)
    return pages


def ocr_image_blocks(image_path, page_number):
    with Image.open(image_path) as image:
        width, height = image.size
    result = subprocess.run(
        ["tesseract", str(image_path), "stdout", "--psm", "6", "tsv"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    rows = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 12:
            continue
        try:
            conf = float(parts[10])
            text = clean_text(parts[11])
            if conf < 0 or not text:
                continue
            rows.append({
                "block": parts[2],
                "par": parts[3],
                "line": parts[4],
                "left": float(parts[6]),
                "top": float(parts[7]),
                "width": float(parts[8]),
                "height": float(parts[9]),
                "text": text,
                "conf": conf,
            })
        except ValueError:
            continue

    grouped = {}
    for row in rows:
        key = (row["block"], row["par"], row["line"])
        grouped.setdefault(key, []).append(row)

    blocks = []
    for _, words in grouped.items():
        words = sorted(words, key=lambda item: item["left"])
        text = clean_text(" ".join(w["text"] for w in words))
        if not text:
            continue
        x0 = min(w["left"] for w in words)
        top = min(w["top"] for w in words)
        x1 = max(w["left"] + w["width"] for w in words)
        bottom = max(w["top"] + w["height"] for w in words)
        confidence = sum(w["conf"] for w in words) / max(len(words), 1)
        blocks.append({
            "text": text,
            "page": page_number,
            "bbox": percent_bbox(x0, top, x1, bottom, width, height),
            "words": [
                {
                    "text": w["text"],
                    "bbox": percent_bbox(
                        w["left"],
                        w["top"],
                        w["left"] + w["width"],
                        w["top"] + w["height"],
                        width,
                        height,
                    ),
                }
                for w in words
            ],
            "source": "ocr",
            "ocrConfidence": round(confidence, 1),
        })
    return blocks


def page_count(path):
    if not is_pdf(path):
        return 1
    with pdfplumber.open(path) as pdf:
        return len(pdf.pages)


def extract_blocks(path, first_page_only=False, force_ocr=False):
    warnings = []
    blocks = []
    pages = 1 if first_page_only else page_count(path)
    with tempfile.TemporaryDirectory(prefix="rentsmooth_ocr_") as tmpdir:
        if is_pdf(path):
            for page_index in range(pages):
                page_blocks = [] if force_ocr else extract_pdf_text_page(path, page_index)
                useful_text = " ".join(b["text"] for b in page_blocks)
                if len(useful_text) < 25:
                    try:
                        image_path = render_pdf_page(path, page_index, tmpdir)
                        page_blocks = ocr_image_blocks(image_path, page_index + 1)
                        warnings.append("OCR fallback used for at least one page.")
                    except Exception:
                        page_blocks = []
                        warnings.append("OCR fallback failed for at least one page.")
                blocks.extend(page_blocks)
        else:
            blocks = ocr_image_blocks(path, 1)
            warnings.append("Image upload processed with OCR fallback.")
    return blocks, sorted(set(warnings))


def text_blob(blocks):
    return "\n".join(b["text"] for b in blocks)


def evidence_chunks(blocks, doc_id):
    chunks = []
    for index, block in enumerate(blocks[:80]):
        text = clean_text(block.get("text", ""))
        if not text:
            continue
        chunks.append({
            "id": f"{doc_id}-chunk-{index + 1}",
            "sourceType": "uploaded_document",
            "sourceDocId": doc_id,
            "text": text[:500],
            "page": int(block.get("page", 1)),
            "bbox": value_bbox_from_line(block),
            "locator": f"page {int(block.get('page', 1))}",
        })
    return chunks


def detect_doc_type(text, selected):
    t = text.lower()
    scores = {
        "application_form": sum(k in t for k in ["application summary", "application date", "household size", "mailing address"]),
        "pay_stub": sum(k in t for k in ["pay stub", "pay date", "gross pay", "net pay", "pay period", "pay frequency"]),
        "benefit_letter": sum(k in t for k in ["benefit letter", "monthly amount", "monthly benefit", "recipient"]),
        "employment_letter": sum(k in t for k in ["employment letter", "hours per week", "hourly rate", "employee"]),
        "gig_statement": sum(k in t for k in ["gig statement", "gross receipts", "platform fees", "statement month"]),
    }
    detected, score = max(scores.items(), key=lambda item: item[1])
    if score == 0:
        return selected, 0.45
    return detected, min(0.98, 0.68 + score * 0.07)


DATE_RE = re.compile(r"\b(20\d{2}-\d{2}(?:-\d{2})?)\b")


def normalize_date(value):
    if not value:
        return None
    if re.fullmatch(r"20\d{2}-\d{2}$", value):
        return f"{value}-01"
    return value


def extract_document_date(text, doc_type):
    lines = [line for line in text.splitlines() if "generated" not in line.lower()]
    patterns = {
        "application_form": [r"application date\s+(20\d{2}-\d{2}-\d{2})"],
        "pay_stub": [r"pay date\s+(20\d{2}-\d{2}-\d{2})"],
        "benefit_letter": [r"letter date\s+(20\d{2}-\d{2}-\d{2})"],
        "employment_letter": [r"letter date\s+(20\d{2}-\d{2}-\d{2})"],
        "gig_statement": [r"statement month\s+(20\d{2}-\d{2})"],
    }
    joined = "\n".join(lines).lower()
    for pattern in patterns.get(doc_type, []):
        match = re.search(pattern, joined, re.I)
        if match:
            return normalize_date(match.group(1)), 0.9
    for line in lines:
        match = DATE_RE.search(line)
        if match:
            return normalize_date(match.group(1)), 0.65
    return None, 0


def find_line(blocks, includes, excludes=()):
    for block in blocks:
        text = block["text"].lower()
        if all(item.lower() in text for item in includes) and not any(item.lower() in text for item in excludes):
            return block
    return None


def next_line_after(blocks, label_block):
    if not label_block:
        return None
    same_page = [b for b in blocks if b["page"] == label_block["page"]]
    same_page = sorted(same_page, key=lambda b: (b["bbox"]["y"], b["bbox"]["x"]))
    try:
        idx = same_page.index(label_block)
    except ValueError:
        return None
    return same_page[idx + 1] if idx + 1 < len(same_page) else None


def value_bbox_from_line(block):
    return pad_value_bbox(block["bbox"]) if block else {"x": 8, "y": 7.55, "w": 30, "h": 4.8}


def clean_token(value):
    return re.sub(r"[^a-z0-9.$,-]", "", str(value).lower())


def merge_bboxes(bboxes):
    if not bboxes:
        return None
    x = min(b["x"] for b in bboxes)
    y = min(b["y"] for b in bboxes)
    x2 = max(b["x"] + b["w"] for b in bboxes)
    y2 = max(b["y"] + b["h"] for b in bboxes)
    return {"x": x, "y": y, "w": x2 - x, "h": y2 - y}


def bbox_for_value_words(block, value):
    if not block or not block.get("words") or value is None:
        return None
    wanted = [clean_token(part) for part in str(value).split() if clean_token(part)]
    if not wanted:
        return None
    words = block["words"]
    tokens = [clean_token(word["text"]) for word in words]
    for idx in range(0, len(tokens) - len(wanted) + 1):
        if tokens[idx: idx + len(wanted)] == wanted:
            merged = merge_bboxes([word["bbox"] for word in words[idx: idx + len(wanted)]])
            return pad_value_bbox(merged, x_pad=0.75, y_pad=0.35, h_pad=0.65) if merged else None
    if len(wanted) == 1:
        wanted_one = wanted[0]
        for idx, token in enumerate(tokens):
            if token == wanted_one or token.endswith(wanted_one) or wanted_one.endswith(token):
                return pad_value_bbox(words[idx]["bbox"], x_pad=0.75, y_pad=0.35, h_pad=0.65)
    return None


def bbox_for_span(block, start, end):
    if not block:
        return value_bbox_from_line(block)
    text = block.get("text", "")
    if not text or start is None or end is None or end <= start:
        return value_bbox_from_line(block)
    length = max(len(text), 1)
    bbox = block["bbox"]
    span_len = max(end - start, 1)
    pad = min(1.75, max(0.8, span_len * 0.1))
    x = bbox["x"] + bbox["w"] * (max(start, 0) / length)
    x2 = bbox["x"] + bbox["w"] * (min(end, length) / length)
    y = max(0, bbox["y"] - 0.45)
    return {
        "x": round(max(0, x - pad), 2),
        "y": round(y, 2),
        "w": round(max(1.2, (x2 - x) + pad * 2), 2),
        "h": round(min(100 - y, bbox["h"] + 0.8), 2),
    }


def bbox_for_match(block, match, group=0):
    if not block or not match:
        return value_bbox_from_line(block)
    word_bbox = bbox_for_value_words(block, match.group(group))
    if word_bbox:
        return word_bbox
    return bbox_for_span(block, match.start(group), match.end(group))


def match_block(block, bbox):
    if not block:
        return block
    return {**block, "bbox": bbox}


def field_format_valid(key, value):
    text = str(value or "").strip()
    if not text:
        return False
    if key in DATE_KEYS:
        return bool(re.fullmatch(r"20\d{2}-\d{2}-\d{2}", text))
    if key in MONTH_KEYS:
        return bool(re.fullmatch(r"20\d{2}-\d{2}", text))
    if key in CURRENCY_KEYS:
        return bool(re.fullmatch(r"\$?\d[\d,]*(?:\.\d{1,2})?", text))
    if key in NUMBER_KEYS:
        return bool(re.fullmatch(r"\d+(?:\.\d+)?", text))
    if key in FREQUENCY_KEYS:
        lower = text.lower()
        return any(term in lower for term in ["weekly", "biweekly", "semi", "monthly"])
    return len(text) >= 2


def block_extraction_score(block, fallback_confidence):
    if block and block.get("ocrConfidence") is not None:
        return max(0, min(float(block["ocrConfidence"]) / 100, 1))
    return max(0, min(float(fallback_confidence) / 100, 1))


def add_field(
    fields,
    doc_id,
    final_type,
    key,
    value,
    block,
    confidence=86,
    bbox=None,
    cross_pass_match=None,
    region_clarity=1.0,
):
    if key in SENSITIVE_KEYS or key not in FIELD_META[final_type]:
        return
    if value is None or str(value).strip() == "":
        return
    label, category = FIELD_META[final_type][key]
    if key in SINGLE_VALUE_KEYS:
        field_id = f"{doc_id}-{key}"
    else:
        occurrence = sum(1 for field in fields if field.get("key") == key) + 1
        field_id = f"{doc_id}-{key}-{occurrence}"
    confidence_result = calculate_field_confidence({
        "ocr_score": block_extraction_score(block, confidence),
        "format_valid": field_format_valid(key, value),
        "cross_pass_match": cross_pass_match,
        "region_clarity": region_clarity,
    })
    fields.append({
        "id": field_id,
        "key": key,
        "label": label,
        "value": str(value).strip(),
        "confidence": confidence_result.confidence_percent,
        "confidenceTier": confidence_result.tier,
        "requiresConfirmation": confidence_result.requires_confirmation,
        "sourceDoc": final_type,
        "sourcePage": int(block["page"] if block else 1),
        "bbox": bbox or bbox_for_value_words(block, value) or value_bbox_from_line(block),
        "confirmed": False,
        "category": category,
        "history": [],
    })


def add_untrusted_field(fields, doc_id, final_type, value):
    fields.append({
        "id": f"{doc_id}-untrusted_instruction",
        "key": "untrusted_instruction",
        "label": "Suspicious instruction",
        "value": str(value).strip(),
        "confidence": 0,
        "sourceDoc": final_type,
        "sourcePage": 1,
        "bbox": {"x": 8, "y": 75, "w": 80, "h": 5},
        "confirmed": False,
        "category": "untrusted",
        "history": [],
    })


def extract_source_name(blocks):
    skip = [
        "training fixture",
        "all names",
        "pay stub",
        "employment letter",
        "benefit letter",
        "gig work",
        "gig statement",
        "application summary",
        "synthetic",
        "not a real",
        "fixture",
        "employee",
        "applicant",
        "recipient",
        "worker",
        "pay date",
        "pay period",
        "letter date",
        "statement month",
    ]
    for block in sorted(blocks, key=lambda b: (b.get("page", 1), b.get("bbox", {}).get("y", 0), b.get("bbox", {}).get("x", 0))):
        text = clean_text(block.get("text", ""))
        if len(text) > 4 and text[0].isupper() and text[1].isupper() and text[2].islower():
            text = text[1:]
        lower = text.lower()
        if not text or len(text) < 3:
            continue
        if re.search(r"\bHH-\d{3}-D\d{2}\b", text, re.I):
            continue
        if any(term in lower for term in skip):
            continue
        if re.search(r"\d{4}-\d{2}", text) or "$" in text:
            continue
        return text, block
    return None, None


def line_after_label_value(blocks, includes):
    label = find_line(blocks, includes)
    return next_line_after(blocks, label), label


def extract_fields(blocks, final_type, doc_id, document_date):
    fields = []
    text = text_blob(blocks)
    lines = [b["text"] for b in blocks]

    if final_type in {"pay_stub", "employment_letter", "benefit_letter", "gig_statement"}:
        source_name, source_block = extract_source_name(blocks)
        if source_name:
            add_field(fields, doc_id, final_type, "source_name", source_name, source_block, 82)

    if final_type == "application_form":
        row, label = line_after_label_value(blocks, ["applicant", "household"])
        if row:
            m = re.match(r"(.+?)\s+(\d+)$", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "person_name", m.group(1), row, 88, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "household_size", m.group(2), row, 88, bbox_for_match(row, m, 2))
            else:
                add_field(fields, doc_id, final_type, "person_name", row["text"], row, 78)
        row, _ = line_after_label_value(blocks, ["mailing", "address"])
        if row:
            add_field(fields, doc_id, final_type, "address", row["text"], row, 86)
        date_block = find_line(blocks, ["application date"]) or find_line(blocks, [document_date or ""])
        date_match = re.search(re.escape(document_date or ""), date_block["text"] if date_block else "")
        add_field(fields, doc_id, final_type, "application_date", document_date, date_block, 90, bbox_for_match(date_block, date_match))

    if final_type == "pay_stub":
        row, _ = line_after_label_value(blocks, ["employee", "pay date"])
        if row:
            m = re.match(r"(.+?)\s+(20\d{2}-\d{2}-\d{2})$", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "person_name", m.group(1), row, 88, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "pay_date", m.group(2), row, 90, bbox_for_match(row, m, 2))
        row, _ = line_after_label_value(blocks, ["pay period", "frequency"])
        if row:
            m = re.search(r"(20\d{2}-\d{2}-\d{2})\s+(20\d{2}-\d{2}-\d{2})\s+([a-zA-Z]+)", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "pay_period_start", m.group(1), row, 86, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "pay_period_end", m.group(2), row, 86, bbox_for_match(row, m, 2))
                add_field(fields, doc_id, final_type, "pay_frequency", m.group(3).lower(), row, 84, bbox_for_match(row, m, 3))
        row, _ = line_after_label_value(blocks, ["regular", "gross", "net"])
        if row:
            money = list(re.finditer(r"\$?\d[\d,]*(?:\.\d{2})?", row["text"]))
            if len(money) >= 4:
                add_field(fields, doc_id, final_type, "regular_hours", money[0].group(0).replace("$", ""), row, 86, bbox_for_match(row, money[0]))
                add_field(fields, doc_id, final_type, "hourly_rate", money[1].group(0), row, 88, bbox_for_match(row, money[1]))
                add_field(fields, doc_id, final_type, "gross_pay", money[2].group(0), row, 90, bbox_for_match(row, money[2]))
                add_field(fields, doc_id, final_type, "net_pay", money[3].group(0), row, 88, bbox_for_match(row, money[3]))

    if final_type == "employment_letter":
        row, _ = line_after_label_value(blocks, ["employee", "letter date"])
        if row:
            m = re.match(r"(.+?)\s+(20\d{2}-\d{2}-\d{2})$", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "person_name", m.group(1), row, 88, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "document_date", m.group(2), row, 90, bbox_for_match(row, m, 2))
        row, _ = line_after_label_value(blocks, ["hours", "hourly"])
        if row:
            nums = list(re.finditer(r"\$?\d[\d,]*(?:\.\d{1,2})?", row["text"]))
            if len(nums) >= 2:
                add_field(fields, doc_id, final_type, "weekly_hours", nums[0].group(0).replace("$", ""), row, 86, bbox_for_match(row, nums[0]))
                add_field(fields, doc_id, final_type, "hourly_rate", nums[1].group(0), row, 88, bbox_for_match(row, nums[1]))

    if final_type == "benefit_letter":
        row, _ = line_after_label_value(blocks, ["recipient", "letter date"])
        if row:
            m = re.match(r"(.+?)\s+(20\d{2}-\d{2}-\d{2})$", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "person_name", m.group(1), row, 88, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "document_date", m.group(2), row, 90, bbox_for_match(row, m, 2))
        for block in blocks:
            lower = block["text"].lower()
            if "monthly" in lower and "$" in block["text"]:
                amount = re.search(r"\$?\d[\d,]*(?:\.\d{2})?", block["text"])
                if amount:
                    add_field(fields, doc_id, final_type, "monthly_benefit", amount.group(0), block, 88, bbox_for_match(block, amount))
                    add_field(fields, doc_id, final_type, "benefit_frequency", "monthly", block, 86)
                    break
        if not any(f["key"] == "monthly_benefit" for f in fields):
            label = find_line(blocks, ["monthly", "frequency"])
            same_page = [b for b in blocks if label and b["page"] == label["page"]]
            same_page = sorted(same_page, key=lambda b: (b["bbox"]["y"], b["bbox"]["x"]))
            if label in same_page:
                idx = same_page.index(label)
                amount_block = same_page[idx + 1] if idx + 1 < len(same_page) else None
                freq_block = same_page[idx + 2] if idx + 2 < len(same_page) else None
                amount = re.search(r"\$?\d[\d,]*(?:\.\d{2})?", amount_block["text"] if amount_block else "")
                if amount:
                    add_field(fields, doc_id, final_type, "monthly_benefit", amount.group(0), amount_block, 88)
                    add_field(fields, doc_id, final_type, "benefit_frequency", (freq_block or amount_block)["text"].lower(), freq_block or amount_block, 84)

    if final_type == "gig_statement":
        row, _ = line_after_label_value(blocks, ["worker", "statement"])
        if row:
            m = re.match(r"(.+?)\s+(20\d{2}-\d{2})", row["text"])
            if m:
                add_field(fields, doc_id, final_type, "person_name", m.group(1), row, 86, bbox_for_match(row, m, 1))
                add_field(fields, doc_id, final_type, "statement_month", m.group(2), row, 88, bbox_for_match(row, m, 2))
        row, _ = line_after_label_value(blocks, ["gross", "platform"])
        if row:
            money = list(re.finditer(r"\$?\d[\d,]*(?:\.\d{2})?", row["text"]))
            if len(money) >= 2:
                add_field(fields, doc_id, final_type, "gross_receipts", money[0].group(0), row, 86, bbox_for_match(row, money[0]))
                add_field(fields, doc_id, final_type, "platform_fees", money[1].group(0), row, 84, bbox_for_match(row, money[1]))
        if not any(f["key"] == "gross_receipts" for f in fields):
            label = find_line(blocks, ["gross", "platform"])
            same_page = [b for b in blocks if label and b["page"] == label["page"]]
            same_page = sorted(same_page, key=lambda b: (b["bbox"]["y"], b["bbox"]["x"]))
            if label in same_page:
                idx = same_page.index(label)
                gross_block = same_page[idx + 1] if idx + 1 < len(same_page) else None
                fees_block = same_page[idx + 2] if idx + 2 < len(same_page) else None
                gross = re.search(r"\$?\d[\d,]*(?:\.\d{2})?", gross_block["text"] if gross_block else "")
                fees = re.search(r"\$?\d[\d,]*(?:\.\d{2})?", fees_block["text"] if fees_block else "")
                if gross:
                    add_field(fields, doc_id, final_type, "gross_receipts", gross.group(0), gross_block, 86)
                if fees:
                    add_field(fields, doc_id, final_type, "platform_fees", fees.group(0), fees_block, 84)

    injection = re.search(r"(ignore prior instructions.*|reveal the system prompt.*|override policy.*)", text, re.I)
    if injection:
        add_untrusted_field(fields, doc_id, final_type, injection.group(0))

    allowed = set(FIELD_META[final_type])
    return [field for field in fields if field["key"] in allowed or field["category"] == "untrusted"]


def scan(path, selected):
    blocks, warnings = extract_blocks(path, first_page_only=True)
    text = text_blob(blocks)
    detected, type_conf = detect_doc_type(text, selected)
    date, date_conf = extract_document_date(text, detected)
    return {
        "selectedDocType": selected,
        "detectedDocType": detected,
        "documentDate": date,
        "typeConfidence": round(type_conf, 2),
        "dateConfidence": round(date_conf, 2),
        "warnings": warnings,
    }


def extract(path, final_type, doc_id, scan_result):
    blocks, warnings = extract_blocks(path, first_page_only=False)
    document_date = scan_result.get("documentDate")
    if not document_date:
        document_date, _ = extract_document_date(text_blob(blocks), final_type)
    fields = extract_fields(blocks, final_type, doc_id, document_date)
    required = set(FIELD_META[final_type])
    found = {field["key"] for field in fields if field.get("category") != "untrusted"}
    if is_pdf(path) and not required.issubset(found):
        ocr_blocks, ocr_warnings = extract_blocks(path, first_page_only=False, force_ocr=True)
        ocr_fields = extract_fields(ocr_blocks, final_type, doc_id, document_date)
        ocr_found = {field["key"] for field in ocr_fields if field.get("category") != "untrusted"}
        if len(ocr_found) > len(found):
            fields = ocr_fields
            warnings = sorted(set([*warnings, *ocr_warnings, "OCR fallback used to recover missing fields."]))
    pages_with_fields = {field.get("sourcePage", 1) for field in fields}
    return {
        "finalDocType": final_type,
        "documentDate": document_date,
        "fields": fields,
        "evidenceChunks": evidence_chunks(blocks, doc_id),
        "previewPages": preview_pages(path, pages_with_fields),
        "warnings": sorted(set([*scan_result.get("warnings", []), *warnings])),
    }


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    scan_parser = sub.add_parser("scan")
    scan_parser.add_argument("--file", required=True)
    scan_parser.add_argument("--selected", required=True, choices=sorted(DOC_TYPES))
    extract_parser = sub.add_parser("extract")
    extract_parser.add_argument("--file", required=True)
    extract_parser.add_argument("--final", required=True, choices=sorted(DOC_TYPES))
    extract_parser.add_argument("--doc-id", required=True)
    extract_parser.add_argument("--scan-json", required=True)
    args = parser.parse_args()

    path = Path(args.file)
    try:
        if args.cmd == "scan":
            payload = scan(path, args.selected)
        else:
            payload = extract(path, getattr(args, "final"), args.doc_id, json.loads(args.scan_json))
        print(json.dumps(payload, separators=(",", ":")))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "warnings": ["Document extraction failed."]}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
