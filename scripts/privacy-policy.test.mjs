import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sessionSource = readFileSync(resolve("src/lib/session-store.tsx"), "utf8");
const extractionSource = readFileSync(resolve("src/lib/extraction-backend.ts"), "utf8");
const serverExtractionSource = readFileSync(
  resolve("src/lib/server-document-extraction.ts"),
  "utf8",
);
const chatSource = readFileSync(resolve("src/lib/chat-guardrails.ts"), "utf8");
const pageShellSource = readFileSync(resolve("src/components/page-shell.tsx"), "utf8");
const packetSource = readFileSync(resolve("src/routes/packet.tsx"), "utf8");
const mergedValueCardSource = readFileSync(resolve("src/components/merged-value-card.tsx"), "utf8");
const confirmSource = readFileSync(resolve("src/routes/confirm.tsx"), "utf8");

test("session state has id, rule version, consent, local audit, and packet marker", () => {
  assert.match(sessionSource, /sessionId:\s*string/);
  assert.match(sessionSource, /ruleVersion:\s*string/);
  assert.match(sessionSource, /consent:\s*SessionConsent/);
  assert.match(sessionSource, /auditEvents:\s*SanitizedAuditEvent\[\]/);
  assert.match(sessionSource, /packetGeneratedAt\?:\s*string/);
});

test("document expiration cutoffs are computed from frozen event date", () => {
  assert.match(sessionSource, /export const DOCUMENT_AGE_LIMIT_DAYS = 60/);
  assert.match(sessionSource, /export const TODAY = "2026-07-18"/);
  assert.match(
    sessionSource,
    /export const DATE_CUTOFF = daysBeforeIso\(TODAY, DOCUMENT_AGE_LIMIT_DAYS\)/,
  );
  assert.match(
    sessionSource,
    /export const SIX_MONTH_CUTOFF = monthsBeforeIso\(TODAY, OLD_VALUE_LIMIT_MONTHS\)/,
  );
  assert.doesNotMatch(sessionSource, /export const TODAY = localIsoDate\(new Date\(\)\)/);
});

test("audit metadata shape excludes raw values, filenames, text, prompts, and packet contents", () => {
  assert.match(sessionSource, /export interface SanitizedAuditEvent/);
  assert.match(sessionSource, /route\?:\s*string/);
  assert.match(sessionSource, /docType\?:\s*DocType/);
  assert.match(sessionSource, /fieldKey\?:\s*string/);
  assert.match(sessionSource, /status\?:\s*string/);
  assert.doesNotMatch(sessionSource, /rawValue|fileName\?:|ocrText|prompt\?:|packetContents/);
  assert.match(sessionSource, /sanitizeAuditMetadata/);
});

test("session delete and reset create a new private session instead of restoring sample data", () => {
  assert.match(
    sessionSource,
    /setSessionState\(\s*appendAudit\(createInitialSession\(\), "session_reset"/,
  );
  assert.match(
    sessionSource,
    /setSessionState\(\s*appendAudit\(createInitialSession\(\), "session_delete"/,
  );
  assert.doesNotMatch(sessionSource, /frequency:\s*"biweekly"/);
});

test("uploaded files remain request-private temp files and are removed in finally", () => {
  assert.match(serverExtractionSource, /mkdtemp\(path\.join\(os\.tmpdir\(\), "rentsmooth-"\)\)/);
  assert.match(
    serverExtractionSource,
    /finally\s*{\s*\/\/ Uploaded files are private[\s\S]*rm\(tempDir, { recursive: true, force: true }\)/,
  );
  assert.match(serverExtractionSource, /writeFile\(filePath, bytes, { mode: 0o600 }\)/);
});

test("extraction permits only predetermined fields and drops sensitive keys", () => {
  assert.match(extractionSource, /const ALLOWED_FIELDS/);
  assert.match(extractionSource, /const SENSITIVE_FIELD_KEYS/);
  assert.match(extractionSource, /validateExtractedFields/);
  assert.match(extractionSource, /allowed\.has\(field\.key\)/);
  assert.match(extractionSource, /SENSITIVE_FIELD_KEYS\.has\(field\.key\)/);
});

test("chat refuses prohibited requests and is wired without raw prompt audit logging", () => {
  for (const pattern of [
    "decision_request",
    "protected_trait",
    "demographic_feature",
    "behavioral_feature",
    "landlord_revenue",
  ]) {
    assert.match(chatSource, new RegExp(pattern));
  }
  assert.match(chatSource, /I cannot decide, approve, deny, rank/);
  assert.match(
    pageShellSource,
    /recordAudit\(classification\.allowed \? "chat_help" : "chat_refusal"/,
  );
  assert.doesNotMatch(pageShellSource, /prompt|rawPrompt|messageText/);
});

test("packet generation clears large uploaded-document derivatives after export or preview", () => {
  assert.match(sessionSource, /stripPacketDerivatives/);
  assert.match(sessionSource, /previewPages:\s*undefined/);
  assert.match(sessionSource, /evidenceChunks:\s*undefined/);
  assert.match(packetSource, /finalizePacket\({ status: "pdf" }\)/);
  assert.match(packetSource, /finalizePacket\({ status: "json" }\)/);
  assert.match(packetSource, /finalizePacket\({ status: "preview" }\)/);
});

test("visible change audit shows original value, not intermediate edit history", () => {
  assert.match(sessionSource, /history = changed \? \[{ at: now, from: f\.value, to: next }\]/);
  assert.doesNotMatch(sessionSource, /from: prev/);
  assert.match(mergedValueCardSource, /Original:/);
  assert.match(confirmSource, /Original:/);
  assert.doesNotMatch(mergedValueCardSource, /Last change|Full history|history\.map/);
  assert.doesNotMatch(confirmSource, /lastChange|Last change|history\.map/);
});
