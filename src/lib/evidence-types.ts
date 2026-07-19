export type EvidenceSourceType = "uploaded_document" | "hud_reference";

export interface EvidenceChunk {
  id: string;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  sourceDocId?: string;
  text: string;
  page?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  locator?: string;
}

export interface ReferenceEvidence {
  thresholdAmount: number;
  householdSize: number;
  effectiveDate: string;
  sourceUrl: string;
  sourceLocator: string;
  sourceName: string;
  chunks: EvidenceChunk[];
  fetchedWithTavily: boolean;
  evidenceMode: "loading" | "tavily" | "frozen";
  warnings: string[];
}

export type ClaimType = "money" | "number" | "date" | "text" | "locator";
export type ClaimSeverity = "warning" | "info";

export interface GroundedClaim {
  id: string;
  label: string;
  claimType: ClaimType;
  value: string;
  normalizedValue: string;
  citationChunkId: string | null;
  severity: ClaimSeverity;
}

export interface CitationVerification {
  claimId: string;
  status: "verified" | "failed" | "not_applicable";
  reason: string;
  matchedText?: string;
  chunkId?: string;
}

export interface VerificationSummary {
  verified: number;
  failed: number;
  notApplicable: number;
}
