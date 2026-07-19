import type {
  CitationVerification,
  ClaimType,
  EvidenceChunk,
  GroundedClaim,
  VerificationSummary,
} from "@/lib/evidence-types";

export function normalizeClaimValue(value: string, claimType: ClaimType): string {
  const cleaned = normalizeText(value);
  if (claimType === "money" || claimType === "number") {
    const numeric = parseNumeric(cleaned);
    return numeric ?? cleaned;
  }
  if (claimType === "date") {
    return normalizeDate(cleaned) ?? cleaned.toLowerCase();
  }
  return cleaned.toLowerCase();
}

export function verifyClaims(
  claims: GroundedClaim[],
  chunks: EvidenceChunk[],
): CitationVerification[] {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return claims.map((claim) => {
    if (!claim.citationChunkId) {
      return {
        claimId: claim.id,
        status: "not_applicable",
        reason: "No citation chunk was attached to this claim.",
      };
    }

    const chunk = byId.get(claim.citationChunkId);
    if (!chunk) {
      return {
        claimId: claim.id,
        status: "not_applicable",
        reason: "The cited chunk is not available in the bounded evidence set.",
        chunkId: claim.citationChunkId,
      };
    }

    const matchedText = findMatch(claim, chunk.text);
    if (matchedText) {
      return {
        claimId: claim.id,
        status: "verified",
        reason: "The cited chunk contains the claimed value.",
        matchedText,
        chunkId: chunk.id,
      };
    }

    return {
      claimId: claim.id,
      status: "failed",
      reason: "The cited chunk does not contain the claimed value.",
      chunkId: chunk.id,
    };
  });
}

export function summarizeVerifications(verifications: CitationVerification[]): VerificationSummary {
  return verifications.reduce(
    (summary, item) => {
      if (item.status === "verified") summary.verified += 1;
      if (item.status === "failed") summary.failed += 1;
      if (item.status === "not_applicable") summary.notApplicable += 1;
      return summary;
    },
    { verified: 0, failed: 0, notApplicable: 0 },
  );
}

export function createGroundedClaim({
  id,
  label,
  claimType,
  value,
  citationChunkId,
  severity = "warning",
}: {
  id: string;
  label: string;
  claimType: ClaimType;
  value: string | number;
  citationChunkId: string | null;
  severity?: GroundedClaim["severity"];
}): GroundedClaim {
  const stringValue = String(value);
  return {
    id,
    label,
    claimType,
    value: stringValue,
    normalizedValue: normalizeClaimValue(stringValue, claimType),
    citationChunkId,
    severity,
  };
}

function findMatch(claim: GroundedClaim, sourceText: string): string | null {
  const normalizedSource = normalizeText(sourceText).toLowerCase();
  const variants = valueVariants(claim.value, claim.claimType);
  return variants.find((variant) => normalizedSource.includes(variant.toLowerCase())) ?? null;
}

function valueVariants(value: string, claimType: ClaimType): string[] {
  const cleaned = normalizeText(value);
  const variants = new Set<string>([cleaned, cleaned.toLowerCase()]);

  if (claimType === "money" || claimType === "number") {
    const numeric = parseNumeric(cleaned);
    if (numeric) {
      variants.add(numeric);
      variants.add(Number(numeric).toLocaleString("en-US"));
      variants.add(Number(numeric).toLocaleString("en-US", { minimumFractionDigits: 2 }));
      variants.add(`$${Number(numeric).toLocaleString("en-US")}`);
      variants.add(
        `$${Number(numeric).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
      );
    }
  }

  if (claimType === "date") {
    const iso = normalizeDate(cleaned);
    if (iso) {
      variants.add(iso);
      const date = new Date(`${iso}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        variants.add(
          date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          }),
        );
      }
    }
  }

  return [...variants].filter(Boolean);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumeric(value: string): string | null {
  const match = value.match(/-?\$?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(/[$,]/g, ""));
  if (!Number.isFinite(number)) return null;
  return Number.isInteger(number) ? String(number) : String(number);
}

function normalizeDate(value: string): string | null {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
