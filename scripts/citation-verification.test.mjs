import assert from "node:assert/strict";
import test from "node:test";

const verifier = await import("../src/lib/citation-verification.ts");

const hudChunk = {
  id: "hud-1",
  sourceType: "hud_reference",
  sourceUrl:
    "https://www.huduser.gov/portal/datasets/mtsp/mtsp26/HERA-Income-Limits-Report-FY26.pdf",
  text: "For a 1-person household, the 60% income limit is $72,000. Effective May 1, 2026.",
  page: 130,
  locator: "PDF page 130",
};

test("money variants verify against the same HUD chunk", () => {
  for (const value of ["$72,000", "72000", "$72,000.00"]) {
    const claim = verifier.createGroundedClaim({
      id: `threshold-${value}`,
      label: "HUD threshold amount",
      claimType: "money",
      value,
      citationChunkId: hudChunk.id,
    });
    const [result] = verifier.verifyClaims([claim], [hudChunk]);
    assert.equal(result.status, "verified");
  }
});

test("wrong amount fails against the cited HUD chunk", () => {
  const claim = verifier.createGroundedClaim({
    id: "wrong-threshold",
    label: "HUD threshold amount",
    claimType: "money",
    value: "$82,320",
    citationChunkId: hudChunk.id,
  });
  const [result] = verifier.verifyClaims([claim], [hudChunk]);
  assert.equal(result.status, "failed");
});

test("uploaded document claims verify only against their uploaded chunk", () => {
  const claim = verifier.createGroundedClaim({
    id: "gross-pay",
    label: "Gross pay",
    claimType: "money",
    value: "$1,800.00",
    citationChunkId: "pay-stub-1",
  });
  const chunks = [
    hudChunk,
    {
      id: "pay-stub-1",
      sourceType: "uploaded_document",
      sourceDocId: "doc-1",
      text: "Gross pay $1,800.00 Net pay $1,412.30",
      page: 1,
    },
  ];
  const [result] = verifier.verifyClaims([claim], chunks);
  assert.equal(result.status, "verified");
  assert.equal(result.chunkId, "pay-stub-1");
});

test("missing citation chunk is not applicable", () => {
  const claim = verifier.createGroundedClaim({
    id: "uncited",
    label: "Calculated annual total",
    claimType: "money",
    value: "$93,600",
    citationChunkId: null,
  });
  const [result] = verifier.verifyClaims([claim], [hudChunk]);
  assert.equal(result.status, "not_applicable");
});
