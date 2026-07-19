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
  process.env.RENTSMOOTH_PYTHON_BIN ??
  (existsSync(BUNDLED_PYTHON) ? BUNDLED_PYTHON : "python3");
const EXTRACTOR = path.resolve(process.cwd(), "scripts/document_extractor.py");

export async function scanUploadedDocument(
  file: File,
  selectedDocType: DocType,
): Promise<ScanResult> {
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

async function withTempUpload<T>(
  file: File,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rentsmooth-"));
  const safeExt = extensionFor(file);
  const filePath = path.join(tempDir, `upload${safeExt}`);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, bytes, { mode: 0o600 });
    await chmod(filePath, 0o600);
    return await fn(filePath);
  } finally {
    // Uploaded files are private to this request and must not survive extraction.
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
