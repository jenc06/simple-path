import { thresholdForHouseholdSize } from "@/lib/session-store";
import type { EvidenceChunk, ReferenceEvidence } from "@/lib/evidence-types";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const HUD_MTSP_PAGE_URL = "https://www.huduser.gov/portal/datasets/mtsp.html";
export const HUD_MTSP_REPORT_URL =
  "https://www.huduser.gov/portal/datasets/mtsp/mtsp26/HERA-Income-Limits-Report-FY26.pdf";

export const ALLOWED_HUD_REFERENCE_URLS = [HUD_MTSP_PAGE_URL, HUD_MTSP_REPORT_URL] as const;
const TAVILY_EXTRACT_URLS = [HUD_MTSP_PAGE_URL] as const;

const ALLOWED_HUD_REFERENCE_URL_SET = new Set<string>(ALLOWED_HUD_REFERENCE_URLS);

interface TavilyExtractResult {
  url: string;
  raw_content?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
  failed_results?: Array<{ url?: string; error?: string }>;
}

const cachedReferenceEvidence = new Map<number, ReferenceEvidence>();
let cachedLocalTavilyApiKey: string | null | undefined;

export function assertAllowedHudReferenceUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Reference URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.huduser.gov" ||
    !ALLOWED_HUD_REFERENCE_URL_SET.has(parsed.toString())
  ) {
    throw new Error("Reference URL is not allowlisted.");
  }
}

export function fallbackReferenceEvidence(
  householdSize: number,
  warnings = [
    "Using frozen HUD threshold data because Tavily reference extraction is not configured.",
  ],
): ReferenceEvidence {
  const threshold = thresholdForHouseholdSize(householdSize);
  return {
    thresholdAmount: threshold.amount,
    householdSize: threshold.householdSize,
    effectiveDate: threshold.effective,
    sourceUrl: threshold.url,
    sourceLocator: `PDF page ${threshold.page}`,
    sourceName: threshold.source,
    chunks: [
      {
        id: "hud-frozen-mtsp-threshold",
        sourceType: "hud_reference",
        sourceUrl: threshold.url,
        text: `${threshold.label} is ${threshold.amount} dollars. Effective ${threshold.effective}.`,
        page: threshold.page,
        locator: `PDF page ${threshold.page}`,
      },
    ],
    fetchedWithTavily: false,
    evidenceMode: "frozen",
    warnings,
  };
}

export async function getReferenceEvidence(householdSize: number): Promise<ReferenceEvidence> {
  const threshold = thresholdForHouseholdSize(householdSize);
  const tavilyApiKey = tavilyApiKeyFromEnvironment();
  if (!tavilyApiKey) {
    return fallbackReferenceEvidence(householdSize);
  }
  const cached = cachedReferenceEvidence.get(threshold.householdSize);
  if (cached) {
    return cached;
  }

  for (const url of ALLOWED_HUD_REFERENCE_URLS) {
    assertAllowedHudReferenceUrl(url);
  }

  try {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tavilyApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [...TAVILY_EXTRACT_URLS],
        extract_depth: "basic",
        format: "text",
        include_images: false,
        include_favicon: false,
        include_usage: true,
        timeout: 12,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`Tavily Extract returned ${response.status}.`);
    }

    const payload = (await response.json()) as TavilyExtractResponse;
    const chunks = referenceChunksFromTavily(payload.results ?? [], threshold);
    const fallback = fallbackReferenceEvidence(householdSize, []);
    const referenceEvidence: ReferenceEvidence = {
      ...fallback,
      chunks:
        chunks.length > 0 ? uniqueEvidenceChunks([...chunks, ...fallback.chunks]) : fallback.chunks,
      fetchedWithTavily: chunks.length > 0,
      evidenceMode: chunks.length > 0 ? "tavily" : "frozen",
      warnings:
        chunks.length > 0
          ? tavilyWarnings(payload)
          : [
              "Tavily reference extraction returned no usable HUD chunks. Using frozen HUD threshold data.",
              ...tavilyWarnings(payload),
            ],
    };
    cachedReferenceEvidence.set(threshold.householdSize, referenceEvidence);
    return referenceEvidence;
  } catch (error) {
    const fallback = fallbackReferenceEvidence(householdSize, []);
    return {
      ...fallback,
      warnings: [
        `Tavily reference extraction failed. ${error instanceof Error ? error.message : "Unknown error."}`,
        ...fallback.warnings,
      ],
    };
  }
}

function uniqueEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    const key = `${chunk.sourceUrl ?? ""}::${chunk.locator ?? ""}::${chunk.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tavilyApiKeyFromEnvironment(): string | undefined {
  const fromProcess =
    typeof process !== "undefined"
      ? (process.env.TAVILY_API_KEY ?? process.env.VITE_TAVILY_API_KEY)?.trim()
      : "";
  if (fromProcess && !isPlaceholderKey(fromProcess)) return fromProcess;

  const fromImportMeta = (
    import.meta.env?.TAVILY_API_KEY ??
    import.meta.env?.VITE_TAVILY_API_KEY ??
    ""
  ).trim();
  if (fromImportMeta && !isPlaceholderKey(fromImportMeta)) return fromImportMeta;

  if (cachedLocalTavilyApiKey !== undefined) return cachedLocalTavilyApiKey ?? undefined;

  const envPaths = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "lovable-app/.env.local"),
    path.resolve(process.cwd(), "lovable-app/.env"),
    path.resolve(process.cwd(), "../.env.local"),
    path.resolve(process.cwd(), "../.env"),
  ];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, "utf8");
    const match = raw.match(/^(?:export\s+)?(?:TAVILY_API_KEY|VITE_TAVILY_API_KEY)\s*=\s*(.*)$/m);
    const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (value && !isPlaceholderKey(value)) {
      cachedLocalTavilyApiKey = value;
      return cachedLocalTavilyApiKey;
    }
  }
  cachedLocalTavilyApiKey = null;
  return cachedLocalTavilyApiKey ?? undefined;
}

function isPlaceholderKey(value: string): boolean {
  return value === "replace_with_your_tavily_api_key" || value.includes("your_tavily");
}

function referenceChunksFromTavily(
  results: TavilyExtractResult[],
  threshold: ReturnType<typeof thresholdForHouseholdSize>,
): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  for (const result of results) {
    assertAllowedHudReferenceUrl(result.url);
    const raw = result.raw_content ?? "";
    if (!normalizeContent(raw)) continue;
    const relevant = selectRelevantSnippets(raw);
    relevant.forEach((text, index) => {
      chunks.push({
        id: `hud-reference-${chunks.length + 1}`,
        sourceType: "hud_reference",
        sourceUrl: result.url,
        text,
        page: result.url === HUD_MTSP_REPORT_URL ? threshold.page : undefined,
        locator:
          result.url === HUD_MTSP_REPORT_URL ? `PDF page ${threshold.page}` : "FY 2026 MTSP page",
      });
    });
  }
  return chunks.slice(0, 8);
}

function selectRelevantSnippets(raw: string): string[] {
  const normalized = normalizeContent(raw);
  const candidates = [
    ...raw.split(/(?<=[.!?])\s+|\n+/).map((line) => normalizeContent(line)),
    ...snippetWindows(normalized),
  ]
    .map((line) => normalizeContent(line))
    .map(stripHudChrome)
    .filter((line) => line.length >= 30 && !isHudChrome(line));

  const scored = candidates
    .map((line) => ({ line, score: snippetScore(line) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.line.slice(0, 500));

  return uniqueSnippets(scored).slice(0, 4);
}

function snippetWindows(raw: string): string[] {
  const anchors = [
    /May 1,\s*2026/gi,
    /Boston-Cambridge-Quincy/gi,
    /\b60%\b/gi,
    /\$?72,?000(?:\.00)?/gi,
    /FY\s*2026/gi,
    /Multifamily Tax Subsidy Projects?/gi,
    /\bMTSP\b/gi,
  ];
  const windows: string[] = [];
  for (const anchor of anchors) {
    for (const match of raw.matchAll(anchor)) {
      const index = match.index ?? 0;
      windows.push(raw.slice(Math.max(0, index - 180), index + 360));
    }
  }
  return windows;
}

function stripHudChrome(value: string): string {
  return value
    .replace(/HUD User (?:Email|Forums|Facebook|Youtube|X|Linkedin|Flicker|Instagram) Icon/gi, "")
    .replace(/\bHome close ABOUT PD&R RESEARCH & PUBLICATIONS DATASETS QUICK LINKS\b/gi, "")
    .replace(/\bABOUT PD&R RESEARCH & PUBLICATIONS DATASETS QUICK LINKS\b/gi, "")
    .replace(/\bSearch Breadcrumb\b/gi, "")
    .replace(/\bDataset Banner Image\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHudChrome(value: string): boolean {
  const chromeHits = [
    /HUD User .* Icon/i,
    /QUICK LINKS/i,
    /ABOUT PD&R/i,
    /Breadcrumb/i,
    /Dataset Banner Image/i,
  ].filter((pattern) => pattern.test(value)).length;
  return chromeHits > 0 && snippetScore(value) < 4;
}

function snippetScore(value: string): number {
  const checks: Array<[RegExp, number]> = [
    [/May 1,\s*2026/i, 5],
    [/\$?72,?000(?:\.00)?/i, 5],
    [/Boston-Cambridge-Quincy/i, 4],
    [/\b60%\b.*\bincome limit|\bincome limit.*\b60%\b/i, 4],
    [/FY\s*2026/i, 3],
    [/\bMTSP\b|Multifamily Tax Subsidy Projects?/i, 2],
    [/HERA-Income-Limits-Report-FY26\.pdf/i, 2],
    [/income limits?/i, 1],
  ];
  return checks.reduce((score, [pattern, weight]) => score + (pattern.test(value) ? weight : 0), 0);
}

function uniqueSnippets(snippets: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const snippet of snippets) {
    const key = snippet
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(snippet);
  }
  return unique;
}

function tavilyWarnings(payload: TavilyExtractResponse): string[] {
  return (payload.failed_results ?? [])
    .filter((failed) => failed.url || failed.error)
    .map(
      (failed) =>
        `Tavily could not extract ${failed.url ?? "a HUD reference"}: ${failed.error ?? "unknown error"}.`,
    );
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
