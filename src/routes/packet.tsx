import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Eye, FileText, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { EditableValue } from "@/components/editable-value";

import {
  DOC_LABELS,
  THRESHOLD,
  TODAY,
  allFields,
  computeAnnualIncome,
  useSession,
  type DocType,
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

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function PacketPage() {
  const { session, setSession } = useSession();
  const [showJson, setShowJson] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fields = useMemo(() => allFields(session), [session]);
  const income = useMemo(() => computeAnnualIncome(session), [session]);
  const annual = income.contributions.length > 0 ? income.annual : NaN;
  const belowOrEqual = !Number.isNaN(annual) && annual <= THRESHOLD.amount;

  const checklist = CHECKLIST.map((t) => {
    const doc = session.docs.find((d) => d.type === t);
    if (!doc) return { type: t, state: "missing" as const };
    if (doc.status === "expired") return { type: t, state: "expired" as const, doc };
    if (doc.status === "uploaded") return { type: t, state: "ok" as const, doc };
    return { type: t, state: "skipped" as const, doc };
  });

  const needsReview = fields.filter((f) => !f.confirmed);

  const jsonExport = {
    generatedAt: TODAY,
    householdSize: session.householdSize,
    frequency: session.frequency,
    fields: fields.map((f) => ({
      fieldName: f.label,
      value: f.corrected ?? f.value,
      originalValue: f.value,
      pageNumber: f.sourcePage,
      bbox: f.bbox,
      confidence: f.confidence,
      confirmed: f.confirmed,
      corrected: !!f.corrected,
    })),
    rule: {
      source: THRESHOLD.source,
      valueUsed: THRESHOLD.label,
      thresholdAmount: THRESHOLD.amount,
      effectiveDate: THRESHOLD.effective,
      page: THRESHOLD.page,
      url: THRESHOLD.url,
    },
    calculation: {
      contributions: income.contributions.map((c) => ({
        label: c.label,
        formula: c.formula,
        amount: c.amount,
      })),
      annualizedIncome: Number.isNaN(annual) ? null : annual,
      comparison: Number.isNaN(annual)
        ? "unavailable"
        : belowOrEqual
          ? "below_or_equal"
          : "above",
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
    setAnnouncement("JSON packet downloaded to your device.");
  }

  function applicantName(): string {
    const f = fields.find((x) => /name/i.test(x.label));
    return f ? (f.corrected ?? f.value) : "—";
  }
  function applicantAddress(): string {
    const f = fields.find((x) => /address/i.test(x.label));
    return f ? (f.corrected ?? f.value) : "—";
  }

  function buildPdf(): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 54;
    const contentW = pageW - M * 2;
    const NAVY: [number, number, number] = [24, 33, 61];
    const INK: [number, number, number] = [30, 30, 34];
    const MUTED: [number, number, number] = [110, 116, 128];
    const RULE: [number, number, number] = [205, 210, 220];
    const BAND: [number, number, number] = [244, 240, 232]; // parchment
    const OK: [number, number, number] = [30, 95, 60];
    const WARN: [number, number, number] = [155, 90, 20];
    const BAD: [number, number, number] = [160, 40, 40];

    let y = 0;

    const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
    const setText = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
    const setDraw = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

    const genLabel = `Generated ${new Date().toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    })}`;
    const packetId = `RS-${new Date().getTime().toString(36).toUpperCase()}`;

    // ---------- masthead (page 1 only) ----------
    setFill(NAVY);
    doc.rect(0, 0, pageW, 92, "F");
    setText([255, 255, 255]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("RENTSMOOTH", M, 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Renter Income Packet", M, 50);
    doc.setFontSize(9);
    doc.text(genLabel, pageW - M, 36, { align: "right" });
    doc.text(`Packet ID: ${packetId}`, pageW - M, 50, { align: "right" });

    // title bar
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Income Packet", M, 82);
    y = 120;

    // ---------- helpers that page-break ----------
    const footerH = 40;

    const addFooter = (pageNum: number) => {
      setDraw(RULE);
      doc.setLineWidth(0.5);
      doc.line(M, pageH - footerH, pageW - M, pageH - footerH);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        "RentSmooth organizes documents and shows factual comparisons. It does not approve or deny housing eligibility.",
        M,
        pageH - footerH + 14,
        { maxWidth: contentW - 90 },
      );
      doc.text(`Page ${pageNum}`, pageW - M, pageH - footerH + 14, { align: "right" });
      doc.text(packetId, pageW - M, pageH - footerH + 26, { align: "right" });
    };

    const ensure = (need: number) => {
      if (y + need > pageH - footerH - 8) {
        doc.addPage();
        y = M;
      }
    };

    // ---------- primitives ----------
    const sectionHeader = (label: string) => {
      ensure(34);
      setText(NAVY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text(label.toUpperCase(), M, y, { charSpace: 1.2 });
      y += 6;
      setDraw(NAVY);
      doc.setLineWidth(1);
      doc.line(M, y, M + 40, y);
      setDraw(RULE);
      doc.setLineWidth(0.5);
      doc.line(M + 40, y, pageW - M, y);
      y += 14;
    };

    const body = (
      text: string,
      opts?: { bold?: boolean; muted?: boolean; size?: number; italic?: boolean },
    ) => {
      const size = opts?.size ?? 10;
      doc.setFont(
        "helvetica",
        opts?.italic ? "italic" : opts?.bold ? "bold" : "normal",
      );
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
      // two-column definition list, wrap-aware
      const labelW = 130;
      const valueW = contentW - labelW - 12;
      doc.setFontSize(10);
      rows.forEach(([k, v]) => {
        doc.setFont("helvetica", "normal");
        const valueLines = doc.splitTextToSize(v || "—", valueW);
        const rowH = Math.max(14, valueLines.length * 13 + 2);
        ensure(rowH);
        setText(MUTED);
        doc.text(k, M, y + 10);
        setText(INK);
        doc.setFont("helvetica", "bold");
        valueLines.forEach((line: string, i: number) => {
          doc.text(line, M + labelW, y + 10 + i * 13);
        });
        y += rowH;
        // divider
        setDraw(RULE);
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
      // header
      ensure(22);
      setFill([248, 246, 242]);
      doc.rect(M, y, contentW, 20, "F");
      setText(NAVY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      let cx = M + 8;
      columns.forEach((col) => {
        doc.text(
          col.header.toUpperCase(),
          col.align === "right" ? cx + col.width - 8 : cx,
          y + 13,
          { align: col.align === "right" ? "right" : "left", charSpace: 0.8 },
        );
        cx += col.width;
      });
      y += 20;

      // rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      setText(INK);
      rows.forEach((r, ri) => {
        // measure
        const cellLines = r.map((cell, ci) =>
          doc.splitTextToSize(cell || "—", columns[ci].width - 16),
        );
        const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH + rowPad * 2;
        ensure(rowH);
        if (ri % 2 === 1) {
          setFill([250, 249, 245]);
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
        setDraw(RULE);
        doc.setLineWidth(0.3);
        doc.line(M, y + rowH, pageW - M, y + rowH);
        y += rowH;
      });
      y += 8;
    };

    // ---------- applicant card ----------
    setFill(BAND);
    setDraw(RULE);
    doc.setLineWidth(0.5);
    const cardH = 78;
    doc.roundedRect(M, y, contentW, cardH, 6, 6, "FD");

    setText(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("APPLICANT", M + 14, y + 18, { charSpace: 1.2 });
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(applicantName(), M + 14, y + 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setText(MUTED);
    doc.text(applicantAddress(), M + 14, y + 55, { maxWidth: contentW * 0.55 });

    // right column meta
    const rightX = M + contentW - 14;
    doc.setFontSize(9);
    doc.text("Household size", rightX, y + 22, { align: "right" });
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(String(session.householdSize), rightX, y + 36, { align: "right" });
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Pay frequency", rightX, y + 52, { align: "right" });
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(session.frequency, rightX, y + 66, { align: "right" });

    y += cardH + 20;

    // ---------- eligibility summary card ----------
    sectionHeader("Eligibility summary");

    const eligibleColor: [number, number, number] = Number.isNaN(annual)
      ? WARN
      : belowOrEqual
        ? OK
        : BAD;
    const eligibleLabel = Number.isNaN(annual)
      ? "Unavailable — missing confirmed income"
      : belowOrEqual
        ? "Annualized income is at or below the threshold"
        : "Annualized income is above the threshold";

    const summaryH = 92;
    ensure(summaryH + 6);
    setFill([252, 251, 248]);
    setDraw(RULE);
    doc.roundedRect(M, y, contentW, summaryH, 6, 6, "FD");
    // left accent bar
    setFill(eligibleColor);
    doc.rect(M, y, 4, summaryH, "F");

    setText(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("ANNUALIZED INCOME", M + 18, y + 20, { charSpace: 1.2 });
    setText(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(Number.isNaN(annual) ? "—" : currency(annual), M + 18, y + 46);

    // vs threshold
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Threshold: ${currency(THRESHOLD.amount)} (${THRESHOLD.label})`,
      M + 18,
      y + 64,
    );
    setText(eligibleColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(eligibleLabel, M + 18, y + 80);

    y += summaryH + 22;

    // ---------- calculation breakdown ----------
    sectionHeader("Calculation breakdown");
    if (Number.isNaN(annual)) {
      body("Calculation unavailable — missing confirmed income or frequency.", {
        italic: true,
        muted: true,
      });
    } else {
      table(
        [
          { header: "Source", width: contentW * 0.35 },
          { header: "Formula", width: contentW * 0.45 },
          { header: "Annual total", width: contentW * 0.2, align: "right" },
        ],
        income.contributions.map((c) => [c.label, c.formula, currency(c.amount)]),
      );
      // totals row
      ensure(24);
      setFill(NAVY);
      doc.rect(M, y, contentW, 22, "F");
      setText([255, 255, 255]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("ANNUALIZED INCOME", M + 8, y + 15, { charSpace: 0.8 });
      doc.text(currency(annual), M + contentW - 8, y + 15, { align: "right" });
      y += 30;
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

    // ---------- documents reviewed ----------
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
    if (fields.length === 0) {
      body("No values on record.", { italic: true, muted: true });
    } else {
      table(
        [
          { header: "Field", width: contentW * 0.32 },
          { header: "Value", width: contentW * 0.28 },
          { header: "Source", width: contentW * 0.28 },
          { header: "Conf.", width: contentW * 0.12, align: "right" },
        ],
        fields.map((f) => [
          f.label + (f.corrected ? "  (corrected)" : ""),
          f.corrected ?? f.value,
          `${DOC_LABELS[f.sourceDoc]}, p.${f.sourcePage}`,
          `${f.confidence}%`,
        ]),
      );
    }

    // ---------- items needing review ----------
    if (needsReview.length > 0) {
      sectionHeader("Items still needing review");
      needsReview.forEach((f) =>
        body(`•  ${f.label} — ${f.corrected ?? f.value}`, { size: 10 }),
      );
      y += 4;
    }

    // ---------- reference source ----------
    sectionHeader("Reference source");
    kv2col([
      ["Source", THRESHOLD.source],
      ["Value used", `${THRESHOLD.label} = ${currency(THRESHOLD.amount)}`],
      ["Effective", THRESHOLD.effective],
      ["Page", String(THRESHOLD.page)],
      ["URL", THRESHOLD.url],
    ]);

    // ---------- disclaimer ----------
    sectionHeader("How this packet was produced");
    body(
      "RentSmooth extracts values from renter-provided documents. The renter reviewed and confirmed every value used in the calculation above. RentSmooth performs a factual comparison against the referenced HUD threshold; it does not decide, approve, or deny eligibility. No demographic data is collected or inferred. Document contents are processed ephemerally and cleared when the session ends.",
      { size: 9, muted: true },
    );

    // ---------- page numbers ----------
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      addFooter(p);
    }

    return doc;
  }

  function downloadPdf() {
    const pdf = buildPdf();
    pdf.save("rentsmooth-packet.pdf");
    setAnnouncement("PDF packet downloaded to your device.");
  }

  function openPdfPreview() {
    const pdf = buildPdf();
    const url = pdf.output("bloburl");
    setPreviewUrl(String(url));
    setPreview(true);
    setAnnouncement("Packet preview ready.");
  }



  function deletePacket() {
    setSession((s) => ({ ...s, docs: [] }));
    setAnnouncement("Packet deleted. Your session is empty.");
  }

  return (
    <PageShell title="Your packet" step="Ready to share">
      <LiveRegion message={announcement} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          Preview packet
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
        <KV k="Household size" v={String(session.householdSize)} />
        <KV k="Session started" v={new Date(session.startedAt).toLocaleString()} />
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
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No values on record yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {fields.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-1.5 rounded-md border bg-card px-3 py-3"
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

      <Section title="Calculation details">
        {Number.isNaN(annual) ? (
          <p className="text-sm text-destructive font-medium">
            Calculation unavailable — missing confirmed income or frequency.
          </p>
        ) : (
          <dl className="space-y-1.5 text-sm">
            {income.contributions.map((c, i) => (
              <Row key={i} k={c.label} v={`${c.formula} = ${currency(c.amount)} / year`} />
            ))}
            <Row k="Annualized income" v={currency(annual)} />
            <Row k="Threshold" v={currency(THRESHOLD.amount)} />
            <Row
              k="Comparison"
              v={belowOrEqual ? "Below or equal to threshold" : "Above threshold"}
            />
          </dl>
        )}
      </Section>

      <Section title="Items that need review">
        {needsReview.length === 0 ? (
          <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800">
            <Check className="h-4 w-4" aria-hidden="true" />
            Everything is confirmed.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {needsReview.map((f) => (
              <li key={f.id}>
                {f.label} — {f.corrected ?? f.value}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sources used">
        <dl className="space-y-1.5 text-sm">
          <Row k="Source" v={THRESHOLD.source} />
          <Row k="Value used" v={`${THRESHOLD.label} = ${currency(THRESHOLD.amount)}`} />
          <Row k="Effective" v={THRESHOLD.effective} />
          <Row k="Page" v={String(THRESHOLD.page)} />
          <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
            <dt className="text-muted-foreground">URL</dt>
            <dd className="break-all sm:text-right">
              <a
                href={THRESHOLD.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {THRESHOLD.url}
              </a>
            </dd>
          </div>
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

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 id="preview-title" className="text-lg font-semibold">
                Packet preview
              </h2>
              <button
                type="button"
                onClick={() => setPreview(false)}
                aria-label="Close preview"
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close
              </button>
            </div>
            <div className="mt-3 space-y-3 text-sm">
              <p>
                <strong>Annualized income:</strong>{" "}
                {Number.isNaN(annual) ? "—" : currency(annual)}
              </p>
              <p>
                <strong>Threshold:</strong> {currency(THRESHOLD.amount)} ({THRESHOLD.label})
              </p>
              <p>
                <strong>Comparison:</strong>{" "}
                {Number.isNaN(annual)
                  ? "unavailable"
                  : belowOrEqual
                    ? "below or equal"
                    : "above"}
              </p>
              <p className="text-xs text-muted-foreground">
                Full details are in the sections on this page.
              </p>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
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

function ChecklistBadge({
  state,
}: {
  state: "ok" | "expired" | "missing" | "skipped";
}) {
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
