import { mockFieldsFor, type DocType, type ExtractedField } from "@/lib/session-store";
import type { EvidenceChunk } from "@/lib/evidence-types";

const ALLOWED_FIELDS: Record<DocType, Set<string>> = {
  application_form: new Set(["person_name", "household_size", "address", "application_date"]),
  pay_stub: new Set([
    "source_name",
    "person_name",
    "pay_date",
    "pay_period_start",
    "pay_period_end",
    "pay_frequency",
    "regular_hours",
    "hourly_rate",
    "gross_pay",
    "net_pay",
  ]),
  benefit_letter: new Set([
    "source_name",
    "person_name",
    "document_date",
    "monthly_benefit",
    "benefit_frequency",
  ]),
  employment_letter: new Set([
    "source_name",
    "person_name",
    "document_date",
    "weekly_hours",
    "hourly_rate",
  ]),
  gig_statement: new Set([
    "source_name",
    "person_name",
    "statement_month",
    "gross_receipts",
    "platform_fees",
  ]),
};

const SENSITIVE_FIELD_KEYS = new Set([
  "ssn",
  "social_security_number",
  "bank_account",
  "routing_number",
  "medical_information",
  "immigration_status",
  "disability_status",
  "race",
  "gender",
]);

export interface ExtractionResult {
  finalDocType: DocType;
  documentDate?: string;
  fields: ExtractedField[];
  evidenceChunks?: EvidenceChunk[];
  previewPages?: Record<number, string>;
  warnings: string[];
}

export interface ScanResult {
  selectedDocType: DocType;
  detectedDocType: DocType;
  documentDate?: string;
  typeConfidence: number;
  dateConfidence: number;
  warnings: string[];
}

export async function scanDocument(file: File, selectedDocType: DocType): Promise<ScanResult> {
  if (typeof window !== "undefined") {
    const serverResult = await scanViaServer(file, selectedDocType);
    if (serverResult) return serverResult;
  }

  const detectedDocType = detectDocumentType(file, selectedDocType);
  const date = inferDocumentDate(mockFieldsFor(detectedDocType, "scan"));

  return {
    selectedDocType,
    detectedDocType,
    documentDate: date,
    typeConfidence: detectedDocType === selectedDocType ? 0.92 : 0.86,
    dateConfidence: date ? 0.88 : 0,
    warnings: [
      "Using demo extraction because the secure server scanner is unavailable. Real PDF preview will not appear.",
      file.type && file.type !== "application/pdf"
        ? "Image upload accepted. Production should process this with OCR fallback."
        : "",
    ].filter(Boolean),
  };
}

export async function extractDocumentFields({
  finalDocType,
  docId,
  file,
  scan,
}: {
  finalDocType: DocType;
  docId: string;
  file: File;
  scan: ScanResult;
}): Promise<ExtractionResult> {
  if (typeof window !== "undefined") {
    const serverResult = await extractViaServer({
      finalDocType,
      docId,
      file,
      scan,
    });
    if (serverResult) return serverResult;
  }

  const fields = validateExtractedFields(finalDocType, mockFieldsFor(finalDocType, docId));

  return {
    finalDocType,
    documentDate: scan.documentDate,
    fields,
    evidenceChunks: [],
    previewPages: {},
    warnings: [
      ...scan.warnings,
      "Using demo extraction because the secure server extractor is unavailable. Real PDF preview will not appear.",
    ],
  };
}

async function scanViaServer(file: File, selectedDocType: DocType): Promise<ScanResult | null> {
  try {
    const form = new FormData();
    form.set("selectedDocType", selectedDocType);
    form.set("file", file);

    const response = await fetch("/api/scan", {
      method: "POST",
      body: form,
    });
    if (!response.ok) return null;

    const result = (await response.json()) as ScanResult;
    return {
      ...result,
      selectedDocType,
      detectedDocType: result.detectedDocType ?? selectedDocType,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  } catch {
    return null;
  }
}

async function extractViaServer({
  finalDocType,
  docId,
  file,
  scan,
}: {
  finalDocType: DocType;
  docId: string;
  file: File;
  scan: ScanResult;
}): Promise<ExtractionResult | null> {
  try {
    const form = new FormData();
    form.set("finalDocType", finalDocType);
    form.set("docId", docId);
    form.set("scan", JSON.stringify(scan));
    form.set("file", file);

    const response = await fetch("/api/extract", {
      method: "POST",
      body: form,
    });
    if (!response.ok) return null;

    const result = (await response.json()) as ExtractionResult;
    return {
      ...result,
      finalDocType,
      documentDate: result.documentDate ?? scan.documentDate,
      fields: validateExtractedFields(finalDocType, result.fields ?? []),
      evidenceChunks: validateEvidenceChunks(result.evidenceChunks ?? []),
      previewPages: normalizePreviewPages(result.previewPages),
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  } catch {
    return null;
  }
}

function normalizePreviewPages(
  previewPages: ExtractionResult["previewPages"] | undefined,
): Record<number, string> {
  if (!previewPages || typeof previewPages !== "object") return {};
  return Object.fromEntries(
    Object.entries(previewPages)
      .map(([page, image]) => [Number(page), typeof image === "string" ? image : ""] as const)
      .filter(([page, image]) => Number.isInteger(page) && page > 0 && image.length > 0),
  );
}

function validateEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
  return chunks
    .filter((chunk) => chunk.sourceType === "uploaded_document")
    .map((chunk) => ({
      id: String(chunk.id),
      sourceType: "uploaded_document" as const,
      sourceDocId: chunk.sourceDocId ? String(chunk.sourceDocId) : undefined,
      text: String(chunk.text ?? "").slice(0, 500),
      page: typeof chunk.page === "number" ? chunk.page : undefined,
      bbox: chunk.bbox,
      locator: chunk.locator ? String(chunk.locator) : undefined,
    }))
    .filter((chunk) => chunk.text.length > 0);
}

function detectDocumentType(file: File, fallback: DocType): DocType {
  // Fast metadata/title scan placeholder. The production backend should replace
  // this with PDF first-page text extraction and OCR fallback, then keep the
  // same return shape.
  const name = file.name.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(application|application summary|app form)\b/.test(name)) {
    return "application_form";
  }
  if (/\b(pay stub|paystub|pay slip|payslip|earnings statement)\b/.test(name)) {
    return "pay_stub";
  }
  if (/\b(benefit|award letter|benefits letter)\b/.test(name)) {
    return "benefit_letter";
  }
  if (/\b(employment|employer|job letter|verification)\b/.test(name)) {
    return "employment_letter";
  }
  if (/\b(gig|platform|statement|receipts)\b/.test(name)) {
    return "gig_statement";
  }
  return fallback;
}

export function validateExtractedFields(
  docType: DocType,
  fields: ExtractedField[],
): ExtractedField[] {
  const allowed = ALLOWED_FIELDS[docType];

  return fields.filter((field) => {
    if (field.category === "untrusted") return true;
    if (SENSITIVE_FIELD_KEYS.has(field.key)) return false;
    return allowed.has(field.key);
  });
}

function inferDocumentDate(fields: ExtractedField[]): string | undefined {
  const dateField = fields.find((field) =>
    ["application_date", "pay_date", "document_date", "statement_month"].includes(field.key),
  );
  if (!dateField) return undefined;
  const value = dateField.corrected ?? dateField.value;
  const isoDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const month = value.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
  );
  if (!month) return undefined;
  const monthNumber = new Date(`${month[1]} 1, ${month[2]}`).getMonth() + 1;
  return `${month[2]}-${String(monthNumber).padStart(2, "0")}-01`;
}
