import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";

import type { DocType } from "@/lib/session-store";
import type { ExtractionResult, ScanResult } from "@/lib/extraction-backend";

const execFileAsync = promisify(execFile);

const BUNDLED_PYTHON =
  "/Users/jennifer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const PYTHON_BIN =
  process.env.RENTSMOOTH_PYTHON_BIN ?? (existsSync(BUNDLED_PYTHON) ? BUNDLED_PYTHON : "python3");
const EXTRACTOR = path.resolve(process.cwd(), "scripts/document_extractor.py");
const EXTRACTOR_SERVICE_URL = process.env.EXTRACTOR_SERVICE_URL?.replace(/\/+$/, "");

export async function fetchDocumentPreview(
  file: File,
  pageNumbers: number[],
): Promise<Record<number, string>> {
  if (!EXTRACTOR_SERVICE_URL) return {};
  try {
    const payload = await callExtractorService("/preview", [
      ["file", file],
      ["pages", JSON.stringify(pageNumbers)],
    ]);
    const result = payload as { previewPages?: Record<string, string> };
    return Object.fromEntries(
      Object.entries(result.previewPages ?? {})
        .map(([k, v]) => [Number(k), v] as const)
        .filter(([k, v]) => Number.isInteger(k) && k > 0 && typeof v === "string" && v.length > 0),
    );
  } catch {
    return {};
  }
}

export async function scanAndExtractUploadedDocument(
  file: File,
  selectedDocType: DocType,
  docId: string,
): Promise<{ scan: ScanResult; extraction: ExtractionResult }> {
  if (EXTRACTOR_SERVICE_URL) {
    const payload = await callExtractorService("/scan-and-extract", [
      ["file", file],
      ["selectedDocType", selectedDocType],
      ["docId", docId],
    ]);
    return payload as { scan: ScanResult; extraction: ExtractionResult };
  }

  return withTempUpload(file, async (filePath) => {
    const scanResult = (await runExtractor([
      "scan",
      "--file",
      filePath,
      "--selected",
      selectedDocType,
    ])) as ScanResult;
    const extractResult = (await runExtractor([
      "extract",
      "--file",
      filePath,
      "--final",
      scanResult.detectedDocType,
      "--doc-id",
      docId,
      "--scan-json",
      JSON.stringify(scanResult),
    ])) as ExtractionResult;
    return { scan: scanResult, extraction: extractResult };
  });
}

export async function scanUploadedDocument(
  file: File,
  selectedDocType: DocType,
): Promise<ScanResult> {
  if (EXTRACTOR_SERVICE_URL) {
    const payload = await callExtractorService("/scan", [
      ["file", file],
      ["selectedDocType", selectedDocType],
    ]);
    return payload as ScanResult;
  }

  return withTempUpload(file, async (filePath) => {
    const payload = await runExtractor(["scan", "--file", filePath, "--selected", selectedDocType]);
    return payload as ScanResult;
  });
}

export async function extractUploadedDocument({
  file,
  finalDocType,
  docId,
  scan,
}: {
  file: File;
  finalDocType: DocType;
  docId: string;
  scan: ScanResult;
}): Promise<ExtractionResult> {
  if (EXTRACTOR_SERVICE_URL) {
    const payload = await callExtractorService("/extract", [
      ["file", file],
      ["finalDocType", finalDocType],
      ["docId", docId],
      ["scanJson", JSON.stringify(scan)],
    ]);
    return payload as ExtractionResult;
  }

  return withTempUpload(file, async (filePath) => {
    const payload = await runExtractor([
      "extract",
      "--file",
      filePath,
      "--final",
      finalDocType,
      "--doc-id",
      docId,
      "--scan-json",
      JSON.stringify(scan),
    ]);
    return payload as ExtractionResult;
  });
}

async function withTempUpload<T>(file: File, fn: (filePath: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rentsmooth-"));
  const safeExt = extensionFor(file);
  const filePath = path.join(tempDir, `upload${safeExt}`);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, bytes, { mode: 0o600 });
    await chmod(filePath, 0o600);
    return await fn(filePath);
  } finally {
    // Uploaded files are private to this request and are removed even if extraction fails.
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extensionFor(file: File): string {
  const name = file.name.toLowerCase();
  const ext = path.extname(name);
  if ([".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"].includes(ext)) {
    return ext;
  }
  if (file.type === "application/pdf") return ".pdf";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/jpeg") return ".jpg";
  return ".bin";
}

async function callExtractorService(pathname: string, entries: Array<[string, string | File]>) {
  const form = new FormData();
  for (const [key, value] of entries) {
    form.append(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(`${EXTRACTOR_SERVICE_URL}${pathname}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : text;
      throw new Error(`Extractor service failed: ${detail || response.statusText}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function runExtractor(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [EXTRACTOR, ...args], {
    timeout: 45_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  const output = JSON.parse(stdout);
  if (output && typeof output === "object" && "error" in output) {
    throw new Error(String(output.error));
  }
  return output;
}
