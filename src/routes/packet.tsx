import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Eye, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import {
  DOC_LABELS,
  THRESHOLD,
  TODAY,
  allFields,
  frequencyMultiplier,
  parseAmount,
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
  const [announcement, setAnnouncement] = useState("");

  const fields = useMemo(() => allFields(session), [session]);
  const payField = fields.find((f) => f.label.toLowerCase().includes("pay before"));
  const amount = payField ? parseAmount(payField.corrected ?? payField.value) : NaN;
  const mult = frequencyMultiplier(session.frequency);
  const annual = mult && !Number.isNaN(amount) ? amount * mult : NaN;
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
      confirmedIncome: Number.isNaN(amount) ? null : amount,
      multiplier: mult,
      annualizedIncome: Number.isNaN(annual) ? null : annual,
      comparison: Number.isNaN(annual)
        ? "unavailable"
        : belowOrEqual
          ? "below_or_equal"
          : "above",
    },
  };

  function download() {
    const blob = new Blob([JSON.stringify(jsonExport, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "income-check-packet.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setAnnouncement("Packet downloaded to your device.");
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
          onClick={download}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download
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
                className="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="font-medium">{f.label}:</span>{" "}
                  <span>{f.corrected ?? f.value}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {DOC_LABELS[f.sourceDoc]}, page {f.sourcePage} • {f.confidence}% confidence
                  {f.corrected ? " • Corrected by you" : ""}
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
            <Row k="Formula" v={`${currency(amount)} × ${mult} = ${currency(annual)}`} />
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
            onClick={download}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
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
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <X className="h-5 w-5" aria-hidden="true" />
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
