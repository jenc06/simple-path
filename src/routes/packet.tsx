import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Download, Eye, FileText, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { EditableValue } from "@/components/editable-value";
import { IncomeSourceTimeline } from "@/components/income-source-timeline";
import { PENDING_FIELD_FOCUS_KEY } from "@/lib/chat-guardrails";
import {
  createGroundedClaim,
  summarizeVerifications,
  verifyClaims,
} from "@/lib/citation-verification";
import { fetchReferenceEvidence, loadingReferenceEvidence } from "@/lib/reference-evidence";

import {
  DOC_LABELS,
  TODAY,
  allFields,
  buildIncomeSourceTimeline,
  computeAnnualIncome,
  detectIncomeSourceReviews,
  effectiveHouseholdSize,
  thresholdForHouseholdSize,
  useSession,
  type DocType,
  type ExtractedField,
  type IncomeResult,
  type IncomeSourceReview,
  type UploadedDoc,
} from "@/lib/session-store";

export const Route = createFileRoute("/packet")({
  head: () => ({
    meta: [{ title: "Your packet — RentSmooth" }],
  }),
  component: PacketPage,
});

const CHECKLIST: DocType[] = [
  "application_form",
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
];
const INCOME_DOCUMENT_TYPES: DocType[] = [
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
];

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pdfPageUrl(url: string, page: number) {
  return `${url}#page=${page}`;
}

function incomeReviewChoiceLabel(choice: string | undefined) {
  switch (choice) {
    case "same_source_count_once":
      return "Same job/source - estimate one annual income";
    case "separate_sources_add_each":
      return "Separate jobs/sources - count each separately";
    case "needs_manual_review":
      return "Not sure - flag for human review";
    default:
      return "Not reviewed";
  }
}

function claimTypeForValue(value: string) {
  if (/^20\d{2}-\d{2}-\d{2}$/.test(value.trim())) return "date";
  if (/^\$/.test(value.trim()) || /,\d{3}/.test(value) || /\.\d{2}$/.test(value.trim())) {
    return "money";
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) return "number";
  return "text";
}

function buildReviewerHandoff({
  annual,
  belowOrEqual,
  income,
  incomeReviews,
  needsReview,
  suspiciousFields,
  unresolvedCitationWarnings,
  docs,
  missingItems,
  expiredItems,
}: {
  annual: number;
  belowOrEqual: boolean;
  income: IncomeResult;
  incomeReviews: IncomeSourceReview[];
  needsReview: ExtractedField[];
  suspiciousFields: ExtractedField[];
  unresolvedCitationWarnings: Array<{ claimId: string }>;
  docs: UploadedDoc[];
  missingItems: string[];
  expiredItems: string[];
}) {
  const unresolvedIncomeReviews = incomeReviews.filter((review) => !review.choice);
  const manualIncomeReviews = incomeReviews.filter(
    (review) => review.choice === "needs_manual_review",
  );
  const openItems = [
    ...missingItems.map((item) => `Missing item: ${item}`),
    ...expiredItems.map((item) => `Expired item: ${item}`),
    ...income.errors.map((error) => `Calculation issue: ${error}`),
    ...needsReview.map((field) => `Unconfirmed value: ${field.label}`),
    ...unresolvedIncomeReviews.map((review) => `Income source decision needed: ${review.reason}`),
    ...manualIncomeReviews.map((review) => `Manual income source review: ${review.reason}`),
    ...unresolvedCitationWarnings.map((warning) => `Source check warning: ${warning.claimId}`),
    ...suspiciousFields.map(
      (field) =>
        `Suspicious document text ignored: ${DOC_LABELS[field.sourceDoc]}, page ${field.sourcePage}`,
    ),
  ];
  const readinessStatus = openItems.length > 0 ? "NEEDS_REVIEW" : "READY_TO_REVIEW";

  return {
    status: readinessStatus,
    readinessStatus,
    annualizedIncome: Number.isNaN(annual) ? null : annual,
    thresholdComparison: Number.isNaN(annual)
      ? "Unavailable"
      : belowOrEqual
        ? "At or below threshold"
        : "Above threshold",
    incomeSourceDecisions: incomeReviews.map((review) => ({
      id: review.id,
      choice: review.choice ?? null,
      choiceLabel: incomeReviewChoiceLabel(review.choice),
      documents: review.documentIds
        .map((id) => docs.find((doc) => doc.id === id)?.fileName)
        .filter(Boolean),
      reason: review.reason,
    })),
    missingItems,
    expiredItems,
    openItems,
    decisionBoundary: "Factual comparison only; RentSmooth does not approve or deny eligibility.",
  };
}

function PacketPage() {
  const { session, setSession, recordAudit, finalizePacket } = useSession();
  const [showJson, setShowJson] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reviewedCitationIds, setReviewedCitationIds] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedBeforePreviewRef = useRef<HTMLElement | null>(null);
  const [referenceEvidence, setReferenceEvidence] = useState(() =>
    loadingReferenceEvidence(effectiveHouseholdSize(session)),
  );

  const fields = useMemo(() => allFields(session), [session]);
  const uploadedEvidence = useMemo(
    () => session.docs.flatMap((d) => d.evidenceChunks ?? []),
    [session.docs],
  );
  const boundedEvidence = useMemo(
    () => [...uploadedEvidence, ...referenceEvidence.chunks],
    [uploadedEvidence, referenceEvidence.chunks],
  );
  const trustedFields = useMemo(() => fields.filter((f) => f.category !== "untrusted"), [fields]);
  const suspiciousFields = useMemo(
    () => fields.filter((f) => f.category === "untrusted"),
    [fields],
  );
  const income = useMemo(() => computeAnnualIncome(session), [session]);
  const incomeReviews = useMemo(() => detectIncomeSourceReviews(session), [session]);
  const householdSize = useMemo(() => effectiveHouseholdSize(session), [session]);
  const threshold = useMemo(() => thresholdForHouseholdSize(householdSize), [householdSize]);
  const annual = income.contributions.length > 0 ? income.annual : NaN;
  const belowOrEqual = !Number.isNaN(annual) && annual <= threshold.amount;

  useEffect(() => {
    let cancelled = false;
    setReferenceEvidence(loadingReferenceEvidence(householdSize));
    fetchReferenceEvidence(householdSize).then((evidence) => {
      if (!cancelled) setReferenceEvidence(evidence);
    });
    return () => {
      cancelled = true;
    };
  }, [householdSize]);

  useEffect(() => {
    const pending = readPendingFieldFocus("/packet");
    if (!pending) return;
    const target = trustedFields.find((field) => field.key === pending.fieldKey);
    if (!target) return;
    setAnnouncement(`${target.label} is ready on the Packet page.`);
    window.requestAnimationFrame(() => {
      const el = fieldElementByKey(target.key);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
    });
  }, [trustedFields]);

  const checklist = CHECKLIST.map((t) => {
    const doc = session.docs.find((d) => d.type === t);
    if (!doc) return { type: t, state: "missing" as const };
    if (doc.status === "expired") return { type: t, state: "expired" as const, doc };
    if (doc.status === "uploaded") return { type: t, state: "ok" as const, doc };
    return { type: t, state: "skipped" as const, doc };
  });
  const missingItems = useMemo(() => {
    const items: string[] = [];
    const application = session.docs.find((doc) => doc.type === "application_form");
    const hasIncomeEvidence = session.docs.some(
      (doc) => INCOME_DOCUMENT_TYPES.includes(doc.type) && doc.status !== "skipped",
    );
    if (!application || application.status === "skipped") items.push(DOC_LABELS.application_form);
    if (!hasIncomeEvidence) items.push("Income evidence document");
    return items;
  }, [session.docs]);
  const expiredItems = useMemo(
    () =>
      session.docs
        .filter((doc) => doc.status === "expired")
        .map(
          (doc) => `${DOC_LABELS[doc.type]}${doc.documentDate ? ` dated ${doc.documentDate}` : ""}`,
        ),
    [session.docs],
  );

  const needsReview = trustedFields.filter((f) => !f.confirmed);
  const claims = useMemo(() => {
    const sourceDocByFieldId = new Map(
      session.docs.flatMap((doc) => doc.fields.map((field) => [field.id, doc] as const)),
    );
    const uploadedChunkForField = (
      fieldId: string,
      page: number,
      value: string,
      claimType: ReturnType<typeof claimTypeForValue>,
    ) => {
      const doc = sourceDocByFieldId.get(fieldId);
      if (!doc) return null;
      const candidates = uploadedEvidence.filter(
        (chunk) => chunk.sourceDocId === doc.id && chunk.page === page,
      );
      const matchingChunk = candidates.find((chunk) => {
        const claim = createGroundedClaim({
          id: `candidate-${fieldId}`,
          label: fieldId,
          claimType,
          value,
          citationChunkId: chunk.id,
        });
        return verifyClaims([claim], [chunk])[0]?.status === "verified";
      });
      return matchingChunk?.id ?? candidates[0]?.id ?? null;
    };
    const referenceChunkForValue = (
      id: string,
      label: string,
      claimType: ReturnType<typeof claimTypeForValue>,
      value: string | number,
    ) => {
      const matchingChunk = referenceEvidence.chunks.find((chunk) => {
        const claim = createGroundedClaim({
          id,
          label,
          claimType,
          value,
          citationChunkId: chunk.id,
        });
        return verifyClaims([claim], [chunk])[0]?.status === "verified";
      });
      return matchingChunk?.id ?? referenceEvidence.chunks[0]?.id ?? null;
    };

    return [
      createGroundedClaim({
        id: "hud-threshold-amount",
        label: "HUD threshold amount",
        claimType: "money",
        value: threshold.amount,
        citationChunkId: referenceChunkForValue(
          "hud-threshold-amount",
          "HUD threshold amount",
          "money",
          threshold.amount,
        ),
      }),
      createGroundedClaim({
        id: "hud-effective-date",
        label: "HUD effective date",
        claimType: "date",
        value: threshold.effective,
        citationChunkId: referenceChunkForValue(
          "hud-effective-date",
          "HUD effective date",
          "date",
          threshold.effective,
        ),
      }),
      createGroundedClaim({
        id: "hud-source-locator",
        label: "HUD source locator",
        claimType: "locator",
        value: `PDF page ${threshold.page}`,
        citationChunkId: null,
        severity: "info",
      }),
      ...trustedFields
        .filter((field) => field.confirmed)
        .map((field) => {
          const value = field.corrected ?? field.value;
          const claimType = claimTypeForValue(value);
          return createGroundedClaim({
            id: `field-${field.id}`,
            label: field.label,
            claimType,
            value,
            citationChunkId: uploadedChunkForField(field.id, field.sourcePage, value, claimType),
          });
        }),
      ...income.contributions.map((contribution, index) =>
        createGroundedClaim({
          id: `calculation-${index + 1}`,
          label: `${contribution.label} annual total`,
          claimType: "money",
          value: contribution.amount,
          citationChunkId: null,
          severity: "info",
        }),
      ),
    ];
  }, [
    income.contributions,
    referenceEvidence.chunks,
    session.docs,
    threshold,
    trustedFields,
    uploadedEvidence,
  ]);
  const citationVerification = useMemo(
    () => verifyClaims(claims, boundedEvidence),
    [boundedEvidence, claims],
  );
  const verificationSummary = useMemo(
    () => summarizeVerifications(citationVerification),
    [citationVerification],
  );
  const failedVerifications = citationVerification.filter((item) => item.status === "failed");
  const unresolvedCitationWarnings = failedVerifications.filter(
    (item) => !reviewedCitationIds.has(item.claimId),
  );
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const fieldByClaimId = useMemo(() => {
    const byId = new Map<string, (typeof trustedFields)[number]>();
    for (const field of trustedFields) byId.set(`field-${field.id}`, field);
    return byId;
  }, [trustedFields]);
  const sourceCheckSummary = `${verificationSummary.verified} matched, ${unresolvedCitationWarnings.length} needs review, ${verificationSummary.notApplicable} calculated`;
  const evidenceModeLabel =
    referenceEvidence.evidenceMode === "loading"
      ? "Checking live HUD reference..."
      : referenceEvidence.fetchedWithTavily
        ? "Tavily Extract from allowlisted HUD URLs"
        : "Frozen local HUD reference";
  const reviewerHandoff = useMemo(
    () =>
      buildReviewerHandoff({
        annual,
        belowOrEqual,
        income,
        incomeReviews,
        needsReview,
        suspiciousFields,
        unresolvedCitationWarnings,
        docs: session.docs,
        missingItems,
        expiredItems,
      }),
    [
      annual,
      belowOrEqual,
      income,
      incomeReviews,
      expiredItems,
      missingItems,
      needsReview,
      session.docs,
      suspiciousFields,
      unresolvedCitationWarnings,
    ],
  );

  const jsonExport = {
    generatedAt: TODAY,
    householdSize,
    frequency: session.frequency,
    household_id: session.sessionId,
    annualized_income: Number.isNaN(annual) ? null : annual,
    comparison: Number.isNaN(annual)
      ? "no_frozen_threshold"
      : belowOrEqual
        ? "below_or_equal"
        : "above",
    readiness_status: reviewerHandoff.readinessStatus,
    readiness_reasons: reviewerHandoff.openItems,
    missing_items: reviewerHandoff.missingItems,
    expired_items: reviewerHandoff.expiredItems,
    fields: trustedFields.map((f) => ({
      fieldName: f.label,
      value: f.corrected ?? f.value,
      originalValue: f.value,
      pageNumber: f.sourcePage,
      bbox: f.bbox,
      confidence: f.confidence,
      confirmed: f.confirmed,
      corrected: !!f.corrected,
    })),
    suspiciousText: suspiciousFields.map((f) => ({
      label: f.label,
      value: f.value,
      source: DOC_LABELS[f.sourceDoc],
      pageNumber: f.sourcePage,
      bbox: f.bbox,
      ignored: true,
      editable: false,
      confirmable: false,
    })),
    rule: {
      source: threshold.source,
      valueUsed: threshold.label,
      thresholdAmount: threshold.amount,
      effectiveDate: threshold.effective,
      page: threshold.page,
      url: threshold.url,
      pageUrl: pdfPageUrl(threshold.url, threshold.page),
      evidenceMode: referenceEvidence.fetchedWithTavily
        ? "tavily_extract_allowlisted_hud_urls"
        : referenceEvidence.evidenceMode === "loading"
          ? "checking_live_hud_reference"
          : "frozen_local_hud_reference",
    },
    evidence: boundedEvidence.map((chunk) => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      sourceUrl: chunk.sourceUrl,
      sourceDocId: chunk.sourceDocId,
      page: chunk.page,
      locator: chunk.locator,
      text: chunk.text,
    })),
    claims,
    citationVerification,
    verificationSummary,
    reviewerHandoff,
    calculation: {
      ruleEffectiveDate: threshold.effective,
      errors: income.errors,
      incomeSourceReviews: incomeReviews.map((review) => ({
        id: review.id,
        documentIds: review.documentIds,
        documents: review.documentIds
          .map((id) => session.docs.find((doc) => doc.id === id)?.fileName)
          .filter(Boolean),
        reason: review.reason,
        confidence: review.confidence,
        choice: review.choice ?? null,
        choiceLabel: incomeReviewChoiceLabel(review.choice),
        canonicalValues: review.canonical ?? null,
        timeline: buildIncomeSourceTimeline(session, review),
      })),
      contributions: income.contributions.map((c) => ({
        label: c.label,
        formula: c.formula,
        amount: c.amount,
        documentIds: c.documentIds,
      })),
      annualizedIncome: Number.isNaN(annual) ? null : annual,
      comparison: Number.isNaN(annual) ? "unavailable" : belowOrEqual ? "below_or_equal" : "above",
      readiness_status: reviewerHandoff.readinessStatus,
      readiness_reasons: reviewerHandoff.openItems,
    },
  };

  function downloadJson() {
    const blob = new Blob([JSON.stringify(jsonExport, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rentsmooth-packet.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    recordAudit("packet_export", { route: "/packet", status: "json" });
    finalizePacket({ status: "json" });
    setAnnouncement("JSON packet downloaded to your device.");
  }

  function applicantName(): string {
    const f = trustedFields.find((x) => /name/i.test(x.label));
    return f ? (f.corrected ?? f.value) : "—";
  }
  function applicantAddress(): string {
    const f = trustedFields.find((x) => /address/i.test(x.label));
    return f ? (f.corrected ?? f.value) : "—";
  }

  function buildPdf(): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 54;
    const contentW = pageW - M * 2;

    // Black & white palette only
    const BLACK: [number, number, number] = [0, 0, 0];
    const INK: [number, number, number] = [20, 20, 20];
    const MUTED: [number, number, number] = [95, 95, 95];
    const RULE: [number, number, number] = [180, 180, 180];
    const RULE_LIGHT: [number, number, number] = [220, 220, 220];
    const BAND: [number, number, number] = [242, 242, 242];
    const BAND_LIGHT: [number, number, number] = [249, 249, 249];

    let y = 0;

    const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
    const setText = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
    const setDraw = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

    const genLabel = `Generated ${new Date().toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    })}`;
    const packetId = `RS-${new Date().getTime().toString(36).toUpperCase()}`;

    // ---------- masthead ----------
    setText(INK);
    doc.setFont("times", "bold");
    doc.setFontSize(9);
    doc.text("RENTSMOOTH", M, 54, { charSpace: 2 });
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text(genLabel, pageW - M, 54, { align: "right" });

    setDraw(BLACK);
    doc.setLineWidth(1);
    doc.line(M, 62, pageW - M, 62);

    doc.setFont("times", "bold");
    doc.setFontSize(22);
    setText(BLACK);
    doc.text("Income Packet", M, 96);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    setText(MUTED);
    doc.text(`Packet ID  ${packetId}`, pageW - M, 96, { align: "right" });

    setDraw(RULE);
    doc.setLineWidth(0.5);
    doc.line(M, 108, pageW - M, 108);

    y = 132;

    const footerH = 40;

    const addFooter = (pageNum: number, total: number) => {
      setDraw(RULE);
      doc.setLineWidth(0.5);
      doc.line(M, pageH - footerH, pageW - M, pageH - footerH);
      setText(MUTED);
      doc.setFont("times", "normal");
      doc.setFontSize(8);
      doc.text(
        "RentSmooth organizes documents and shows factual comparisons. It does not approve or deny housing eligibility.",
        M,
        pageH - footerH + 14,
        { maxWidth: contentW - 120 },
      );
      doc.text(`${packetId}   •   Page ${pageNum} of ${total}`, pageW - M, pageH - footerH + 14, {
        align: "right",
      });
    };

    const ensure = (need: number) => {
      if (y + need > pageH - footerH - 8) {
        doc.addPage();
        y = M;
      }
    };

    const sectionHeader = (label: string) => {
      ensure(30);
      setText(BLACK);
      doc.setFont("times", "bold");
      doc.setFontSize(8);
      doc.text(label.toUpperCase(), M, y, { charSpace: 1.5 });
      y += 6;
      setDraw(BLACK);
      doc.setLineWidth(0.75);
      doc.line(M, y, pageW - M, y);
      y += 16;
    };

    const body = (
      text: string,
      opts?: { bold?: boolean; muted?: boolean; size?: number; italic?: boolean },
    ) => {
      const size = opts?.size ?? 10;
      doc.setFont("times", opts?.italic ? "italic" : opts?.bold ? "bold" : "normal");
      doc.setFontSize(size);
      setText(opts?.muted ? MUTED : INK);
      const lines = doc.splitTextToSize(text, contentW);
      const lh = size + 3;
      for (const l of lines) {
        ensure(lh);
        doc.text(l, M, y);
        y += lh;
      }
    };

    const kv2col = (rows: Array<[string, string]>) => {
      const labelW = 130;
      const valueW = contentW - labelW - 12;
      doc.setFontSize(10);
      rows.forEach(([k, v]) => {
        doc.setFont("times", "normal");
        const valueLines = doc.splitTextToSize(v || "—", valueW);
        const rowH = Math.max(16, valueLines.length * 13 + 4);
        ensure(rowH);
        setText(MUTED);
        doc.text(k, M, y + 10);
        setText(INK);
        doc.setFont("times", "bold");
        valueLines.forEach((line: string, i: number) => {
          doc.text(line, M + labelW, y + 10 + i * 13);
        });
        y += rowH;
        setDraw(RULE_LIGHT);
        doc.setLineWidth(0.3);
        doc.line(M, y, pageW - M, y);
        y += 2;
      });
      y += 4;
    };

    const table = (
      columns: Array<{ header: string; width: number; align?: "left" | "right" }>,
      rows: string[][],
    ) => {
      const rowPad = 6;
      const lineH = 12;
      ensure(24);
      setFill(BLACK);
      doc.rect(M, y, contentW, 20, "F");
      setText([255, 255, 255]);
      doc.setFont("times", "bold");
      doc.setFontSize(8.5);
      let cx = M + 8;
      columns.forEach((col) => {
        doc.text(
          col.header.toUpperCase(),
          col.align === "right" ? cx + col.width - 8 : cx,
          y + 13,
          { align: col.align === "right" ? "right" : "left", charSpace: 1 },
        );
        cx += col.width;
      });
      y += 20;

      doc.setFont("times", "normal");
      doc.setFontSize(10);
      setText(INK);
      rows.forEach((r, ri) => {
        const cellLines = r.map((cell, ci) =>
          doc.splitTextToSize(cell || "—", columns[ci].width - 16),
        );
        const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH + rowPad * 2;
        ensure(rowH);
        if (ri % 2 === 1) {
          setFill(BAND_LIGHT);
          doc.rect(M, y, contentW, rowH, "F");
        }
        let x = M + 8;
        cellLines.forEach((lines, ci) => {
          lines.forEach((l: string, li: number) => {
            doc.text(
              l,
              columns[ci].align === "right" ? x + columns[ci].width - 16 : x,
              y + rowPad + 9 + li * lineH,
              { align: columns[ci].align === "right" ? "right" : "left" },
            );
          });
          x += columns[ci].width;
        });
        setDraw(RULE_LIGHT);
        doc.setLineWidth(0.3);
        doc.line(M, y + rowH, pageW - M, y + rowH);
        y += rowH;
      });
      setDraw(BLACK);
      doc.setLineWidth(0.5);
      doc.line(M, y, pageW - M, y);
      y += 10;
    };

    // ---------- applicant card ----------
    setFill(BAND);
    setDraw(BLACK);
    doc.setLineWidth(0.5);
    const cardH = 84;
    doc.rect(M, y, contentW, cardH, "FD");

    setText(MUTED);
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.text("APPLICANT", M + 14, y + 20, { charSpace: 1.5 });
    setText(BLACK);
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text(applicantName(), M + 14, y + 42);
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    setText(INK);
    doc.text(applicantAddress(), M + 14, y + 60, { maxWidth: contentW * 0.55 });

    const rightX = M + contentW - 14;
    setText(MUTED);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text("Household size", rightX, y + 22, { align: "right" });
    setText(BLACK);
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(String(householdSize), rightX, y + 38, { align: "right" });
    setText(MUTED);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text("Pay frequency", rightX, y + 56, { align: "right" });
    setText(BLACK);
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(session.frequency, rightX, y + 72, { align: "right" });

    y += cardH + 22;

    // ---------- readiness summary ----------
    sectionHeader("Readiness summary");

    const eligibleLabel = Number.isNaN(annual)
      ? "UNAVAILABLE — missing confirmed income"
      : belowOrEqual
        ? "At or below the referenced threshold"
        : "Above the referenced threshold";

    const summaryH = 96;
    ensure(summaryH + 6);
    setDraw(BLACK);
    doc.setLineWidth(0.75);
    doc.rect(M, y, contentW, summaryH, "S");

    setText(MUTED);
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.text("ANNUALIZED INCOME", M + 16, y + 22, { charSpace: 1.5 });
    setText(BLACK);
    doc.setFont("times", "bold");
    doc.setFontSize(24);
    doc.text(Number.isNaN(annual) ? "—" : currency(annual), M + 16, y + 52);

    setText(MUTED);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text(`Threshold  ${currency(threshold.amount)}   (${threshold.label})`, M + 16, y + 70);
    doc.text(`Rule effective date  ${threshold.effective}`, M + 16, y + 82);
    setText(BLACK);
    doc.setFont("times", "bold");
    doc.setFontSize(10);
    doc.text(eligibleLabel, M + 16, y + 94);

    y += summaryH + 24;

    // ---------- reviewer handoff ----------
    sectionHeader("Reviewer Handoff");
    kv2col([
      ["Status", reviewerHandoff.readinessStatus],
      [
        "Annualized income",
        reviewerHandoff.annualizedIncome === null
          ? "Unavailable"
          : currency(reviewerHandoff.annualizedIncome),
      ],
      ["Threshold comparison", reviewerHandoff.thresholdComparison],
      [
        "Income-source decisions",
        reviewerHandoff.incomeSourceDecisions.length === 0
          ? "No duplicate income groups found"
          : reviewerHandoff.incomeSourceDecisions.map((item) => item.choiceLabel).join("; "),
      ],
    ]);
    if (reviewerHandoff.openItems.length === 0) {
      body("Open review items: none.", { size: 9, muted: true });
    } else {
      body("Open review items:", { size: 9, bold: true });
      reviewerHandoff.openItems.forEach((item) => body(`- ${item}`, { size: 9, muted: true }));
    }
    body(reviewerHandoff.decisionBoundary, { size: 9, muted: true });

    // ---------- calculation breakdown ----------
    sectionHeader("Calculation breakdown");
    if (Number.isNaN(annual)) {
      if (income.errors.length > 0) {
        income.errors.forEach((error) => body(error, { italic: true, muted: true }));
      } else {
        body("Calculation unavailable — missing confirmed income or frequency.", {
          italic: true,
          muted: true,
        });
      }
    } else {
      table(
        [
          { header: "Source", width: contentW * 0.35 },
          { header: "Formula", width: contentW * 0.45 },
          { header: "Annual total", width: contentW * 0.2, align: "right" },
        ],
        income.contributions.map((c) => [c.label, c.formula, currency(c.amount)]),
      );
      ensure(26);
      setFill(BLACK);
      doc.rect(M, y, contentW, 24, "F");
      setText([255, 255, 255]);
      doc.setFont("times", "bold");
      doc.setFontSize(10);
      doc.text("ANNUALIZED INCOME", M + 8, y + 16, { charSpace: 1 });
      doc.text(currency(annual), M + contentW - 8, y + 16, { align: "right" });
      y += 32;
      body(`Rule effective date: ${threshold.effective}`, { size: 9, muted: true });
    }

    if (incomeReviews.length > 0) {
      sectionHeader("Income source handling");
      incomeReviews.forEach((review) => {
        const files = review.documentIds
          .map((id) => session.docs.find((doc) => doc.id === id)?.fileName)
          .filter(Boolean)
          .join(", ");
        body(`${incomeReviewChoiceLabel(review.choice)}: ${files}`, {
          size: 9,
          muted: review.choice === "needs_manual_review",
        });
        if (review.canonical?.confirmed) {
          body(
            `Canonical values used: ${review.canonical.weeklyHours ?? "unknown"} hrs/wk at ${review.canonical.hourlyRate ?? "unknown"}. Gross ${review.canonical.grossPay ?? "unknown"}; net ${review.canonical.netPay ?? "unknown"}.`,
            { size: 8, muted: true },
          );
        }
        body(review.reason, { size: 8, muted: true });
        buildIncomeSourceTimeline(session, review).forEach((event) => {
          body(`${event.title}: ${event.detail}`, { size: 8, muted: true });
        });
      });
    }

    // ---------- document checklist ----------
    sectionHeader("Document checklist");
    table(
      [
        { header: "Document", width: contentW * 0.6 },
        { header: "Status", width: contentW * 0.4, align: "right" },
      ],
      checklist.map((c) => [
        DOC_LABELS[c.type],
        {
          ok: "Provided",
          expired: "Uploaded but expired",
          missing: "Not uploaded",
          skipped: "Marked as N/A",
        }[c.state],
      ]),
    );

    // ---------- documents provided ----------
    const reviewed = session.docs.filter((d) => d.status !== "skipped");
    sectionHeader("Documents provided");
    if (reviewed.length === 0) {
      body("No documents provided.", { italic: true, muted: true });
    } else {
      table(
        [
          { header: "Type", width: contentW * 0.4 },
          { header: "File name", width: contentW * 0.6 },
        ],
        reviewed.map((d) => [DOC_LABELS[d.type], d.fileName]),
      );
    }

    // ---------- confirmed values ----------
    sectionHeader("Confirmed values");
    if (trustedFields.length === 0) {
      body("No values on record.", { italic: true, muted: true });
    } else {
      table(
        [
          { header: "Field", width: contentW * 0.32 },
          { header: "Value", width: contentW * 0.28 },
          { header: "Source", width: contentW * 0.28 },
          { header: "Conf.", width: contentW * 0.12, align: "right" },
        ],
        trustedFields.map((f) => [
          f.label + (f.corrected ? "  (corrected)" : ""),
          f.corrected ?? f.value,
          `${DOC_LABELS[f.sourceDoc]}, p.${f.sourcePage}`,
          `${f.confidence}%`,
        ]),
      );
    }

    if (needsReview.length > 0) {
      sectionHeader("Items still needing review");
      needsReview.forEach((f) => body(`•  ${f.label} — ${f.corrected ?? f.value}`, { size: 10 }));
      y += 4;
    }

    if (suspiciousFields.length > 0) {
      sectionHeader("Safety warnings");
      suspiciousFields.forEach((f) =>
        body(
          `Ignored suspicious text from ${DOC_LABELS[f.sourceDoc]}, page ${f.sourcePage}: ${f.value}`,
          { size: 9, muted: true },
        ),
      );
      y += 4;
    }

    if (failedVerifications.length > 0) {
      sectionHeader("Source check warnings");
      failedVerifications.forEach((verification) => {
        const claim = claimById.get(verification.claimId);
        body(
          `${claim?.label ?? verification.claimId}: cited evidence did not contain "${claim?.value ?? "the claimed value"}".`,
          { size: 9, muted: true },
        );
      });
      y += 4;
    }

    sectionHeader("Reference source");
    kv2col([
      ["Source", threshold.source],
      ["Evidence mode", evidenceModeLabel],
      ["Value used", `${threshold.label} = ${currency(threshold.amount)}`],
      ["Effective", threshold.effective],
      ["Page", String(threshold.page)],
      ["URL", pdfPageUrl(threshold.url, threshold.page)],
    ]);
    if (referenceEvidence.chunks.length > 0) {
      body(`Reference evidence: ${referenceEvidence.chunks[0].text}`, {
        size: 9,
        muted: true,
      });
    }

    sectionHeader("How this packet was produced");
    body(
      "RentSmooth extracts values from renter-provided documents. The renter reviewed and confirmed every value used in the calculation above. RentSmooth performs a factual comparison against the referenced HUD threshold; it does not decide, approve, or deny eligibility. No demographic data is collected or inferred. Document contents are processed ephemerally and cleared when the session ends.",
      { size: 9, muted: true },
    );

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      addFooter(p, pageCount);
    }

    return doc;
  }

  function downloadPdf() {
    const pdf = buildPdf();
    pdf.save("rentsmooth-packet.pdf");
    recordAudit("packet_export", { route: "/packet", status: "pdf" });
    finalizePacket({ status: "pdf" });
    setAnnouncement("PDF packet downloaded to your device.");
  }

  function openPdfPreview() {
    try {
      const pdf = buildPdf();
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      lastFocusedBeforePreviewRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPreviewUrl(url);
      setPreview(true);
      finalizePacket({ status: "preview" });
      setAnnouncement("Packet preview ready.");
    } catch (e) {
      console.error("Preview failed", e);
      setAnnouncement("Could not build preview. Please try downloading instead.");
    }
  }

  function closePdfPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(false);
    setPreviewUrl(null);
    window.requestAnimationFrame(() => {
      lastFocusedBeforePreviewRef.current?.focus();
    });
  }

  function handlePreviewKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePdfPreview();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function reviewCitationWarning(claimId: string) {
    setReviewedCitationIds((current) => new Set([...current, claimId]));
    recordAudit("source_warning_review", { route: "/packet", status: "reviewed" });
    setAnnouncement("Source warning marked reviewed.");
  }

  function jumpToClaimSource(claimId: string) {
    const field = fieldByClaimId.get(claimId);
    if (field) {
      document.getElementById(`field-${field.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setAnnouncement(`${field.label} is ready to review.`);
      return;
    }
    if (claimId.startsWith("hud-")) {
      window.open(pdfPageUrl(threshold.url, threshold.page), "_blank", "noreferrer");
      setAnnouncement("HUD source opened in a new tab.");
      return;
    }
    document.getElementById("sources-used")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAnnouncement("Source details are ready to review.");
  }

  function deletePacket() {
    setSession((s) => ({
      ...s,
      docs: [],
      incomeSourceReviews: [],
      packetGeneratedAt: undefined,
    }));
    recordAudit("packet_delete", { route: "/packet", status: "deleted" });
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setPreview(false);
    setAnnouncement("Packet deleted. Your session is empty.");
  }

  return (
    <PageShell title="Your packet" step="Ready to share">
      <LiveRegion message={announcement} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={openPdfPreview}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          Preview PDF
        </button>
        <button
          type="button"
          onClick={downloadPdf}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download PDF
        </button>
      </div>

      <Section title="Renter information">
        <KV k="Household size" v={String(householdSize)} />
        <KV k="Session started" v={new Date(session.startedAt).toLocaleString()} />
      </Section>

      <Section title="Reviewer Handoff">
        <div className="rounded-md border bg-card px-3 py-3">
          <dl className="space-y-1.5 text-sm">
            <Row k="Status" v={reviewerHandoff.readinessStatus} />
            <Row
              k="Annualized income"
              v={
                reviewerHandoff.annualizedIncome === null
                  ? "Unavailable"
                  : currency(reviewerHandoff.annualizedIncome)
              }
            />
            <Row k="Threshold comparison" v={reviewerHandoff.thresholdComparison} />
            <Row
              k="Income-source decisions"
              v={
                reviewerHandoff.incomeSourceDecisions.length === 0
                  ? "No duplicate income groups found"
                  : reviewerHandoff.incomeSourceDecisions.map((item) => item.choiceLabel).join("; ")
              }
            />
          </dl>
          <div className="mt-3 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Open review items
            </p>
            {reviewerHandoff.openItems.length === 0 ? (
              <p className="mt-1 text-sm font-medium text-emerald-800">No open review items.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {reviewerHandoff.openItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{reviewerHandoff.decisionBoundary}</p>
          </div>
        </div>
      </Section>

      <Section title="Document checklist">
        <ul className="space-y-2 text-sm">
          {checklist.map((c) => (
            <li
              key={c.type}
              className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
            >
              <span className="font-medium">{DOC_LABELS[c.type]}</span>
              <ChecklistBadge state={c.state} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Documents reviewed">
        <ul className="space-y-1.5 text-sm">
          {session.docs
            .filter((d) => d.status !== "skipped")
            .map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span className="font-medium">{DOC_LABELS[d.type]}</span>
                <span className="text-muted-foreground">{d.fileName}</span>
              </li>
            ))}
          {session.docs.filter((d) => d.status !== "skipped").length === 0 && (
            <li className="text-muted-foreground">No documents reviewed.</li>
          )}
        </ul>
      </Section>

      <Section title="Confirmed income information">
        {trustedFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No values on record yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {trustedFields.map((f) => (
              <li
                key={f.id}
                id={`field-${f.id}`}
                data-field-key={f.key}
                tabIndex={-1}
                className="scroll-mt-24 flex flex-col gap-1.5 rounded-md border bg-card px-3 py-3"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </span>
                <EditableValue
                  field={f}
                  size="md"
                  onSaved={(v) =>
                    setAnnouncement(`${f.label} updated to ${v}. Packet recalculated.`)
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {DOC_LABELS[f.sourceDoc]}, page {f.sourcePage} • {f.confidence}% confidence
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {suspiciousFields.length > 0 && (
        <Section title="Safety warnings">
          <ul className="space-y-2 text-sm">
            {suspiciousFields.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-red-600/40 bg-red-50 px-3 py-3 text-red-950"
              >
                <p className="text-sm font-semibold">Suspicious text was found and ignored</p>
                <p className="mt-1 rounded-md border border-red-200 bg-white p-2 font-mono text-xs">
                  {f.value}
                </p>
                <p className="mt-2 text-xs text-red-900/80">
                  This item cannot be edited, confirmed, or used in calculations. Source:{" "}
                  {DOC_LABELS[f.sourceDoc]}, page {f.sourcePage}.
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {failedVerifications.length > 0 && (
        <Section title="Source check warnings">
          <ul className="space-y-2 text-sm">
            {failedVerifications.map((verification) => {
              const claim = claimById.get(verification.claimId);
              const field = fieldByClaimId.get(verification.claimId);
              const reviewed = reviewedCitationIds.has(verification.claimId);
              return (
                <li
                  key={verification.claimId}
                  className={
                    "rounded-md border px-3 py-3 " +
                    (reviewed
                      ? "border-emerald-700/30 bg-emerald-50 text-emerald-950"
                      : "border-amber-600/40 bg-amber-50 text-amber-950")
                  }
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    {reviewed ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    )}
                    {claim?.label ?? verification.claimId}
                  </p>
                  <p className="mt-1 text-xs">
                    The cited evidence did not contain "{claim?.value ?? "the claimed value"}".
                    {field
                      ? " Review the field value below, then edit it if needed or mark this warning reviewed."
                      : " Review the source, then mark this warning reviewed if it is acceptable."}
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => jumpToClaimSource(verification.claimId)}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-current/30 px-3 text-xs font-semibold hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {field ? "Review field" : "Review source"}
                    </button>
                    {!reviewed && (
                      <button
                        type="button"
                        onClick={() => reviewCitationWarning(verification.claimId)}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-amber-900 px-3 text-xs font-semibold text-white hover:bg-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        Mark reviewed
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {referenceEvidence.warnings.length > 0 && (
        <Section title="Retrieval warnings">
          <ul className="space-y-2 text-sm">
            {referenceEvidence.warnings.map((warning) => (
              <li
                key={warning}
                className="rounded-md border border-amber-600/40 bg-amber-50 px-3 py-3 text-amber-950"
              >
                {warning}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {incomeReviews.length > 0 && (
        <Section title="Income source handling">
          <ul className="space-y-2 text-sm">
            {incomeReviews.map((review) => {
              const files = review.documentIds
                .map((id) => session.docs.find((doc) => doc.id === id)?.fileName)
                .filter(Boolean)
                .join(", ");
              return (
                <li key={review.id} className="rounded-md border bg-card px-3 py-3">
                  <p className="font-semibold">{incomeReviewChoiceLabel(review.choice)}</p>
                  <p className="mt-1 text-muted-foreground">{files}</p>
                  {review.canonical?.confirmed && (
                    <p className="mt-1 text-xs font-medium text-foreground">
                      Using canonical values: {review.canonical.weeklyHours ?? "unknown"} hrs/wk at{" "}
                      {review.canonical.hourlyRate ?? "unknown"}. Gross{" "}
                      {review.canonical.grossPay ?? "unknown"}; net{" "}
                      {review.canonical.netPay ?? "unknown"}.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{review.reason}</p>
                  <IncomeSourceTimeline session={session} review={review} compact />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Calculation details">
        {Number.isNaN(annual) ? (
          <div className="space-y-1 text-sm text-destructive font-medium">
            {income.errors.length > 0 ? (
              income.errors.map((error) => <p key={error}>{error}</p>)
            ) : (
              <p>Calculation unavailable — missing confirmed income or frequency.</p>
            )}
          </div>
        ) : (
          <dl className="space-y-1.5 text-sm">
            {income.contributions.map((c, i) => (
              <Row key={i} k={c.label} v={`${c.formula} = ${currency(c.amount)} / year`} />
            ))}
            <Row k="Annualized income" v={currency(annual)} />
            <Row k="Threshold" v={currency(threshold.amount)} />
            <Row k="Rule effective date" v={threshold.effective} />
            <Row
              k="Comparison"
              v={belowOrEqual ? "Below or equal to threshold" : "Above threshold"}
            />
          </dl>
        )}
      </Section>

      <Section title="Items that need review">
        {reviewerHandoff.openItems.length === 0 ? (
          <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800">
            <Check className="h-4 w-4" aria-hidden="true" />
            Everything is confirmed and source checks are clear.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {reviewerHandoff.openItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sources used" id="sources-used">
        <dl className="space-y-1.5 text-sm">
          <Row k="Source" v={threshold.source} />
          <Row k="Evidence mode" v={evidenceModeLabel} />
          <Row k="Value used" v={`${threshold.label} = ${currency(threshold.amount)}`} />
          <Row k="Effective" v={threshold.effective} />
          <Row k="Page" v={String(threshold.page)} />
          <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
            <dt className="text-muted-foreground">URL</dt>
            <dd className="break-all sm:text-right">
              <a
                href={pdfPageUrl(threshold.url, threshold.page)}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {pdfPageUrl(threshold.url, threshold.page)}
              </a>
            </dd>
          </div>
          {referenceEvidence.chunks.length > 0 && (
            <Row k="Evidence snippet" v={referenceEvidence.chunks[0].text} />
          )}
          <Row
            k="Bounded evidence chunks"
            v={`${boundedEvidence.length} total: ${uploadedEvidence.length} uploaded-document, ${referenceEvidence.chunks.length} HUD reference`}
          />
          <Row k="Source checks" v={sourceCheckSummary} />
        </dl>
      </Section>

      <Section title="Renter controls">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={downloadPdf}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export packet (PDF)
          </button>
          <button
            type="button"
            onClick={downloadJson}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Export packet (JSON)
          </button>

          <button
            type="button"
            onClick={deletePacket}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-destructive/40 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete my packet
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Export timestamp: {new Date().toISOString()}
        </p>
      </Section>

      <Section title="Technical appendix (for reviewers)">
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          aria-expanded={showJson}
          className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {showJson ? "Hide JSON export" : "Show JSON export"}
        </button>
        {showJson && (
          <pre className="mt-3 max-h-80 overflow-auto rounded-md border bg-muted p-3 text-[11px] leading-relaxed">
            {JSON.stringify(jsonExport, null, 2)}
          </pre>
        )}
      </Section>

      {preview && previewUrl && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          aria-describedby="preview-keyboard-help"
          className="fixed inset-0 z-50 flex flex-col bg-black/60 p-0 sm:p-4"
          onKeyDown={handlePreviewKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closePdfPreview();
            }
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
              <h2 id="preview-title" className="font-serif text-lg font-semibold">
                Packet preview
              </h2>
              <p id="preview-keyboard-help" className="sr-only">
                Packet preview dialog showing the generated PDF. Use Tab to move through preview
                actions, and Escape to close.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download PDF
                </button>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Open in new tab
                </a>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Close preview
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-muted">
              <iframe
                src={previewUrl}
                title="Generated PDF packet preview"
                className="h-full min-h-[70vh] w-full border-0 bg-white"
              />
            </div>
            <div className="border-t bg-card px-4 py-2 text-xs text-muted-foreground">
              This is the generated PDF packet. Use Open in new tab if your browser blocks embedded
              PDF viewing.
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-24">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium sm:text-right">{v}</dd>
    </div>
  );
}

function readPendingFieldFocus(path: string): { fieldKey: string } | null {
  const raw = window.sessionStorage.getItem(PENDING_FIELD_FOCUS_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as { path?: unknown; fieldKey?: unknown };
    if (pending.path !== path || typeof pending.fieldKey !== "string") return null;
    window.sessionStorage.removeItem(PENDING_FIELD_FOCUS_KEY);
    return { fieldKey: pending.fieldKey };
  } catch {
    window.sessionStorage.removeItem(PENDING_FIELD_FOCUS_KEY);
    return null;
  }
}

function fieldElementByKey(fieldKey: string): HTMLElement | null {
  const elements = document.querySelectorAll<HTMLElement>("[data-field-key]");
  return Array.from(elements).find((el) => el.dataset.fieldKey === fieldKey) ?? null;
}

function ChecklistBadge({ state }: { state: "ok" | "expired" | "missing" | "skipped" }) {
  const map = {
    ok: {
      cls: "border-emerald-700/40 bg-emerald-50 text-emerald-900",
      text: "Provided",
      Icon: Check,
    },
    expired: {
      cls: "border-amber-700/40 bg-amber-50 text-amber-900",
      text: "Uploaded but expired",
      Icon: Eye,
    },
    missing: {
      cls: "border-destructive/40 bg-destructive/5 text-destructive",
      text: "Not uploaded",
      Icon: X,
    },
    skipped: {
      cls: "border-input bg-muted text-muted-foreground",
      text: "Marked as N/A",
      Icon: X,
    },
  } as const;
  const { cls, text, Icon } = map[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}
