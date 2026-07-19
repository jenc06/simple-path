import { thresholdForHouseholdSize } from "@/lib/session-store";
import type { ReferenceEvidence } from "@/lib/evidence-types";

export function frozenReferenceEvidence(
  householdSize: number,
  warnings: string[] = [],
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

export function loadingReferenceEvidence(householdSize: number): ReferenceEvidence {
  return {
    ...frozenReferenceEvidence(householdSize),
    evidenceMode: "loading",
    warnings: [],
  };
}

export async function fetchReferenceEvidence(householdSize: number): Promise<ReferenceEvidence> {
  try {
    const response = await fetch(
      `/api/reference-evidence?householdSize=${encodeURIComponent(String(householdSize))}`,
    );
    if (!response.ok) {
      return frozenReferenceEvidence(householdSize, [
        `Could not check live HUD reference. Reference endpoint returned ${response.status}.`,
      ]);
    }
    return (await response.json()) as ReferenceEvidence;
  } catch (error) {
    return frozenReferenceEvidence(householdSize, [
      `Could not check live HUD reference. ${error instanceof Error ? error.message : "Unknown error."}`,
    ]);
  }
}
