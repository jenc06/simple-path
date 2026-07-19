import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sourcePath = resolve("src/lib/reference-evidence.server.ts");
const source = readFileSync(sourcePath, "utf8");
const packetSource = readFileSync(resolve("src/routes/packet.tsx"), "utf8");
const docPreviewSource = readFileSync(resolve("src/components/doc-preview.tsx"), "utf8");
const serverExtractionSource = readFileSync(
  resolve("src/lib/server-document-extraction.ts"),
  "utf8",
);
const extractionBackendSource = readFileSync(resolve("src/lib/extraction-backend.ts"), "utf8");

test("Tavily integration is extract-only and HUD allowlisted", () => {
  assert.match(source, /api\.tavily\.com\/extract/);
  assert.match(source, /TAVILY_EXTRACT_URLS = \[HUD_MTSP_PAGE_URL\]/);
  assert.match(source, /AbortSignal\.timeout\(15000\)/);
  assert.doesNotMatch(source, /api\.tavily\.com\/search/);
  assert.doesNotMatch(source, /api\.tavily\.com\/crawl/);
  assert.doesNotMatch(source, /api\.tavily\.com\/research/);
  assert.match(source, /www\.huduser\.gov/);
  assert.match(source, /assertAllowedHudReferenceUrl/);
});

test("Tavily key lookup covers configured local and runtime environments", () => {
  assert.match(source, /process\.env\.TAVILY_API_KEY/);
  assert.match(source, /process\.env\.VITE_TAVILY_API_KEY/);
  assert.match(source, /import\.meta\.env\?\.TAVILY_API_KEY/);
  assert.match(source, /\.env\.local/);
  assert.match(source, /lovable-app\/\.env/);
  assert.match(source, /\(\?:export\\s\+\)\?/);
  assert.match(source, /for \(const envPath of envPaths\)/);
});

test("Tavily request module does not accept uploaded file payloads", () => {
  assert.doesNotMatch(source, /file:\s*File/);
  assert.doesNotMatch(source, /FormData/);
  assert.doesNotMatch(source, /arrayBuffer/);
});

test("Tavily snippets filter HUD page chrome before display", () => {
  assert.match(source, /stripHudChrome/);
  assert.match(source, /HUD User .* Icon/);
  assert.match(source, /QUICK LINKS/);
  assert.match(source, /Dataset Banner Image/);
  assert.match(source, /snippetScore/);
});

test("packet export uses only bounded evidence chunks", () => {
  assert.match(packetSource, /boundedEvidence/);
  assert.match(packetSource, /uploadedEvidence/);
  assert.match(packetSource, /referenceEvidence\.chunks/);
  assert.doesNotMatch(packetSource, /sourceType:\s*"search_result"/);
});

test("packet export includes source check results and warnings", () => {
  assert.match(packetSource, /claims/);
  assert.match(packetSource, /citationVerification/);
  assert.match(packetSource, /verificationSummary/);
  assert.match(packetSource, /Source check warnings/);
  assert.match(packetSource, /Mark reviewed/);
  assert.match(packetSource, /Source checks compare each packet claim with its cited evidence/);
  assert.match(packetSource, /calculated means the value came from the app's calculation script/);
});

test("packet preview embeds the generated PDF blob directly", () => {
  assert.match(packetSource, /const blob = pdf\.output\("blob"\)/);
  assert.match(packetSource, /URL\.createObjectURL\(blob\)/);
  assert.match(packetSource, /<iframe[\s\S]*src=\{previewUrl\}/);
  assert.match(packetSource, /Generated PDF packet preview/);
  assert.doesNotMatch(packetSource, /This preview mirrors the PDF packet content/);
});

test("packet distinguishes live HUD lookup from frozen fallback", () => {
  assert.match(packetSource, /loadingReferenceEvidence/);
  assert.match(packetSource, /Checking live HUD reference/);
  assert.match(packetSource, /evidenceModeLabel/);
  assert.match(source, /evidenceMode: chunks\.length > 0 \? "tavily" : "frozen"/);
  assert.match(source, /Tavily reference extraction failed/);
});

test("HUD claims cite chunks that contain their own values", () => {
  assert.match(packetSource, /referenceChunkForValue/);
  assert.doesNotMatch(packetSource, /const referenceChunkId = referenceEvidence\.chunks\[0\]/);
  assert.match(source, /uniqueEvidenceChunks\(\[\.\.\.chunks, \.\.\.fallback\.chunks\]\)/);
});

test("packet uses household-size thresholds and readiness status", () => {
  const sessionSource = readFileSync(resolve("src/lib/session-store.tsx"), "utf8");
  assert.match(sessionSource, /export const MTSP_60_LIMITS/);
  assert.match(sessionSource, /8:\s*135780/);
  assert.match(sessionSource, /thresholdForHouseholdSize/);
  assert.match(packetSource, /readiness_status: reviewerHandoff\.readinessStatus/);
  assert.match(packetSource, /READY_TO_REVIEW/);
  assert.match(packetSource, /NEEDS_REVIEW/);
});

test("packet identifies missing or expired items without blocking export", () => {
  assert.match(packetSource, /missingItems/);
  assert.match(packetSource, /expiredItems/);
  assert.match(packetSource, /Missing item:/);
  assert.match(packetSource, /Expired item:/);
  assert.match(packetSource, /missing_items: reviewerHandoff\.missingItems/);
  assert.match(packetSource, /expired_items: reviewerHandoff\.expiredItems/);
  assert.match(packetSource, /Export packet \(PDF\)/);
  assert.match(packetSource, /Export packet \(JSON\)/);
});

test("document source boxes use a clear amber highlight", () => {
  assert.match(docPreviewSource, /field\.category === "untrusted"/);
  assert.match(docPreviewSource, /border-amber-600/);
  assert.doesNotMatch(docPreviewSource, /border-sky-600/);
  assert.doesNotMatch(docPreviewSource, /bg-sky-300/);
  assert.match(docPreviewSource, /Suspicious instruction found here/);
});

test("Vercel extraction forwards to a hosted OCR service without silent mock fallback", () => {
  assert.match(serverExtractionSource, /process\.env\.EXTRACTOR_SERVICE_URL/);
  assert.match(serverExtractionSource, /callExtractorService\("\/scan"/);
  assert.match(serverExtractionSource, /callExtractorService\("\/extract"/);
  assert.match(serverExtractionSource, /runExtractor\(\["scan"/);
  assert.match(serverExtractionSource, /runExtractor\(\[\s*"extract"/);
  assert.match(extractionBackendSource, /throw new Error\(await extractionErrorMessage/);
  assert.doesNotMatch(extractionBackendSource, /if \(!response\.ok\) return null/);
});
