import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sessionStore = readFileSync(resolve("src/lib/session-store.tsx"), "utf8");
const reviewRoute = readFileSync(resolve("src/routes/review.tsx"), "utf8");
const confirmRoute = readFileSync(resolve("src/routes/confirm.tsx"), "utf8");
const packetRoute = readFileSync(resolve("src/routes/packet.tsx"), "utf8");
const timelineComponent = readFileSync(
  resolve("src/components/income-source-timeline.tsx"),
  "utf8",
);

test("same-source pay stubs are detected by shared source and frequency, not identical gross pay", () => {
  assert.match(sessionStore, /normalizedText\(a\.sourceName\) === normalizedText\(b\.sourceName\)/);
  assert.match(sessionStore, /a\.payFrequency === b\.payFrequency/);
  const payStubBranch = sessionStore.match(
    /if \(a\.doc\.type === "pay_stub" && b\.doc\.type === "pay_stub"\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(payStubBranch);
  assert.doesNotMatch(payStubBranch, /roughlyEqual\(a\.grossPay, b\.grossPay/);
});

test("same-source grouped pay stubs are averaged and counted once", () => {
  assert.match(sessionStore, /payStubs\.length > 1 && employmentLetters\.length === 0/);
  assert.match(sessionStore, /averageGross/);
  assert.match(sessionStore, /avg\(\$\{sampleValues\}\) × \$\{mult\}/);
  assert.match(sessionStore, /amount: averageGross \* mult/);
});

test("same-source canonical income values are stored and used for calculation", () => {
  assert.match(sessionStore, /interface CanonicalIncomeSourceValues/);
  assert.match(sessionStore, /canonical\?: CanonicalIncomeSourceValues/);
  assert.match(sessionStore, /updateIncomeSourceCanonical/);
  assert.match(sessionStore, /sameIncomeSourceCanonicalReview/);
  assert.match(sessionStore, /canonical\?\.confirmed/);
  assert.match(sessionStore, /canonicalRate \* canonicalWeeklyHours \* 52/);
});

test("same-source conflicts require canonical confirmation before calculation", () => {
  assert.match(sessionStore, /requiresCanonicalConfirmation/);
  assert.match(
    sessionStore,
    /Same income source documents disagree\. Choose the canonical income values before calculation\./,
  );
  assert.match(reviewRoute, /Same income source values used for calculation/);
  assert.match(confirmRoute, /Same income source values used for calculation/);
  assert.match(reviewRoute, /Original sources disagree/);
  assert.match(
    confirmRoute,
    /Duplicate source values will not affect calculation unless saved here/,
  );
  assert.match(reviewRoute, /unresolvedCanonicalReviews/);
  assert.match(confirmRoute, /unresolvedCanonicalReviews/);
  assert.match(reviewRoute, /Not allowed - save same income source values/);
  assert.match(confirmRoute, /Not allowed - save same income source values/);
});

test("unresolved and manual-review income-source choices block calculation", () => {
  assert.match(
    sessionStore,
    /Possible duplicate income documents need review before calculation\./,
  );
  assert.match(sessionStore, /Income source grouping is flagged for manual review\./);
  assert.match(reviewRoute, /disabled=\{[\s\S]*unresolvedIncomeReviews > 0/);
  assert.match(confirmRoute, /disabled=\{unresolvedIncomeReviews > 0/);
});

test("renter-facing choice labels are explicit", () => {
  for (const source of [reviewRoute, confirmRoute]) {
    assert.match(
      source,
      /Are these from the same ongoing income source or separate income sources\?/,
    );
    assert.match(source, /Same job\/source - estimate one annual income/);
    assert.match(source, /Separate jobs\/sources - count each separately/);
    assert.match(source, /Not sure - flag for human review/);
  }
});

test("packet export includes income-source review decisions", () => {
  assert.match(packetRoute, /detectIncomeSourceReviews/);
  assert.match(packetRoute, /incomeSourceReviews: incomeReviews\.map/);
  assert.match(packetRoute, /choiceLabel: incomeReviewChoiceLabel/);
  assert.match(packetRoute, /timeline: buildIncomeSourceTimeline/);
  assert.match(packetRoute, /<Section title="Income source handling">/);
  assert.match(packetRoute, /sectionHeader\("Income source handling"\)/);
});

test("duplicate income reviews show why counted once timeline", () => {
  assert.match(sessionStore, /export function buildIncomeSourceTimeline/);
  assert.match(sessionStore, /Pay stubs are repeated evidence/);
  assert.match(sessionStore, /Counted once/);
  assert.match(timelineComponent, /Why Counted Once/);
  assert.match(reviewRoute, /<IncomeSourceTimeline session=\{session\} review=\{review\}/);
  assert.match(confirmRoute, /<IncomeSourceTimeline session=\{session\} review=\{review\}/);
});

test("packet includes compact reviewer handoff in every export surface", () => {
  assert.match(packetRoute, /function buildReviewerHandoff/);
  assert.match(packetRoute, /reviewerHandoff/);
  assert.match(packetRoute, /<Section title="Reviewer Handoff">/);
  assert.match(packetRoute, /sectionHeader\("Reviewer Handoff"\)/);
  assert.match(packetRoute, /<iframe[\s\S]*Generated PDF packet preview/);
  assert.match(packetRoute, /decisionBoundary/);
  assert.match(packetRoute, /Factual comparison only/);
});
