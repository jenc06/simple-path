import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { EditableValue } from "@/components/editable-value";
import { IncomeSourceTimeline } from "@/components/income-source-timeline";
import { validateNumericField } from "@/lib/income-validation";
import { PENDING_FIELD_FOCUS_KEY } from "@/lib/chat-guardrails";
import {
  DOC_LABELS,
  allFields,
  detectIncomeSourceReviews,
  mergedFields,
  sameIncomeSourceCanonicalReview,
  useSession,
  type CanonicalIncomeSourceValues,
  type IncomeSourceReview,
  type IncomeSourceReviewChoice,
  type MergedField,
  type SessionState,
  type UploadedDoc,
} from "@/lib/session-store";

export const Route = createFileRoute("/confirm")({
  head: () => ({
    meta: [{ title: "Final confirmation — SimplePath" }],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { session, resolveIncomeSourceReview, updateIncomeSourceCanonical } = useSession();
  const merged = useMemo(() => mergedFields(session), [session]);
  const fields = useMemo(() => allFields(session), [session]);
  const incomeReviews = useMemo(() => detectIncomeSourceReviews(session), [session]);
  const [announcement, setAnnouncement] = useState("");
  const navigate = useNavigate();

  const basic = merged.filter((m) => m.category === "basic");
  const calc = merged.filter((m) => m.category === "calculation");
  const anyOld = merged.some((m) => m.isOld);
  const unresolvedIncomeReviews = incomeReviews.filter((review) => !review.choice).length;
  const unresolvedCanonicalReviews = incomeReviews.filter(
    (review) => sameIncomeSourceCanonicalReview(session, review).requiresCanonicalConfirmation,
  ).length;

  useEffect(() => {
    const pending = readPendingFieldFocus("/confirm");
    if (!pending) return;
    const target = merged.find((m) => m.key === pending.fieldKey);
    if (!target) return;
    setAnnouncement(`${target.label} is ready on the Confirm page.`);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`field-key-${target.key}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
    });
  }, [merged]);

  return (
    <PageShell title="Confirm your information" step="Final review">
      <LiveRegion message={announcement} />

      <p className="text-sm text-muted-foreground">
        Everything below is what SimplePath will use. Tap any value to change it — nothing is used
        until you confirm here.
      </p>

      {anyOld && (
        <div
          role="note"
          className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">
              Some values come from documents older than 6 months.
            </span>{" "}
            Check that they are still accurate.
          </p>
        </div>
      )}

      <Section title="Basic information">
        {basic.map((m) => (
          <Row key={`b-${m.mergeId}`} merged={m} fields={fields} onEdited={setAnnouncement} />
        ))}
        {basic.length === 0 && <EmptyRow />}
      </Section>

      <Section title="Values used for calculation">
        {calc.map((m) => (
          <Row key={`c-${m.mergeId}`} merged={m} fields={fields} onEdited={setAnnouncement} />
        ))}
        {calc.length === 0 && <EmptyRow />}
      </Section>

      {incomeReviews.length > 0 && (
        <section className="mt-6" aria-labelledby="income-source-review">
          <h2
            id="income-source-review"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Income source review
          </h2>
          <div className="space-y-3">
            {incomeReviews.map((review) => (
              <IncomeSourceReviewCard
                key={review.id}
                review={review}
                docs={session.docs}
                session={session}
                onResolve={(choice) => {
                  resolveIncomeSourceReview(review.id, choice);
                  setAnnouncement("Income source review saved.");
                }}
                onCanonicalSave={(canonical) => {
                  updateIncomeSourceCanonical(review.id, canonical);
                  setAnnouncement("Same income source values saved.");
                }}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setAnnouncement("All information confirmed. Continuing to calculation.");
            navigate({ to: "/calculation" });
          }}
          disabled={unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0}
          aria-disabled={unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0}
          aria-describedby={
            unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0
              ? "confirm-not-allowed"
              : undefined
          }
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {unresolvedCanonicalReviews > 0
            ? "Not allowed - save same income source values"
            : unresolvedIncomeReviews > 0
              ? "Not allowed - review income source question"
              : "Yes, this information is correct"}
        </button>
        {(unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0) && (
          <p id="confirm-not-allowed" className="text-xs font-medium text-amber-800">
            Not allowed yet: answer the income source question and save same-source canonical values
            before calculating.
          </p>
        )}
        <button
          type="button"
          onClick={() => navigate({ to: "/review" })}
          className="inline-flex h-11 w-full items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Go back and change something
        </button>
      </div>
    </PageShell>
  );
}

function IncomeSourceReviewCard({
  review,
  docs,
  session,
  onResolve,
  onCanonicalSave,
}: {
  review: IncomeSourceReview;
  docs: UploadedDoc[];
  session: SessionState;
  onResolve: (choice: IncomeSourceReviewChoice) => void;
  onCanonicalSave: (canonical: CanonicalIncomeSourceValues | undefined) => void;
}) {
  const groupedDocs = review.documentIds
    .map((id) => docs.find((doc) => doc.id === id))
    .filter((doc): doc is UploadedDoc => !!doc);
  const canonicalReview = sameIncomeSourceCanonicalReview(session, review);
  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">
            Are these from the same ongoing income source or separate income sources?
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{review.reason}</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
          {review.choice ? "Reviewed" : "Needs review"}
        </span>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {groupedDocs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
          >
            <span className="min-w-0 truncate">{doc.fileName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{DOC_LABELS[doc.type]}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <ChoiceButton
          active={review.choice === "same_source_count_once"}
          onClick={() => onResolve("same_source_count_once")}
        >
          Same job/source - estimate one annual income
        </ChoiceButton>
        <ChoiceButton
          active={review.choice === "separate_sources_add_each"}
          onClick={() => onResolve("separate_sources_add_each")}
        >
          Separate jobs/sources - count each separately
        </ChoiceButton>
        <ChoiceButton
          active={review.choice === "needs_manual_review"}
          onClick={() => onResolve("needs_manual_review")}
        >
          Not sure - flag for human review
        </ChoiceButton>
      </div>
      {review.choice === "needs_manual_review" && (
        <p className="mt-3 text-sm font-medium text-amber-900">
          This will stop the calculation so a person can review the income source.
        </p>
      )}
      <IncomeSourceTimeline session={session} review={review} />
      {review.choice === "same_source_count_once" && (
        <CanonicalIncomeSourceEditor
          review={review}
          details={canonicalReview}
          onSave={onCanonicalSave}
        />
      )}
    </article>
  );
}

function CanonicalIncomeSourceEditor({
  review,
  details,
  onSave,
}: {
  review: IncomeSourceReview;
  details: ReturnType<typeof sameIncomeSourceCanonicalReview>;
  onSave: (canonical: CanonicalIncomeSourceValues | undefined) => void;
}) {
  const initial = review.canonical ?? details.suggested;
  const [draft, setDraft] = useState<CanonicalIncomeSourceValues>(initial);
  const [error, setError] = useState("");

  function update(key: keyof CanonicalIncomeSourceValues, value: string) {
    const next = { ...draft, [key]: value };
    const regularHours = parseMoneyish(key === "regularHours" ? value : (next.regularHours ?? ""));
    const hourlyRate = parseMoneyish(key === "hourlyRate" ? value : (next.hourlyRate ?? ""));
    if (Number.isFinite(regularHours) && Number.isFinite(hourlyRate)) {
      const gross = regularHours * hourlyRate;
      const sourceGross = parseMoneyish(details.suggested.grossPay ?? "");
      const sourceNet = parseMoneyish(details.suggested.netPay ?? "");
      next.grossPay = formatCurrencyForUi(gross);
      if (Number.isFinite(sourceGross) && sourceGross > 0 && Number.isFinite(sourceNet)) {
        next.netPay = formatCurrencyForUi(gross * (sourceNet / sourceGross));
      }
    }
    setError("");
    setDraft(next);
  }

  function save() {
    const fields: Array<[keyof CanonicalIncomeSourceValues, string]> = [
      ["weeklyHours", "weekly_hours"],
      ["hourlyRate", "hourly_rate"],
      ["regularHours", "regular_hours"],
      ["grossPay", "gross_pay"],
      ["netPay", "net_pay"],
    ];
    for (const [key, validationKey] of fields) {
      const value = draft[key] as string | undefined;
      if (!value) continue;
      const validation = validateNumericField(validationKey, value);
      if (!validation.ok) {
        setError(validation.error ?? "Same income source value is not valid.");
        return;
      }
    }
    setError("");
    onSave({ ...draft, confirmed: true });
  }

  return (
    <div className="mt-4 rounded-md border bg-background p-3">
      <h4 className="text-sm font-semibold">Same income source values used for calculation</h4>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {details.evidenceRows.map((row) => (
          <li key={row.docId}>
            {row.label}:{" "}
            {row.regularHours !== undefined &&
              `${row.regularHours} regular hours / ${row.payFrequency} = ${row.weeklyHours} weekly hours; `}
            {row.weeklyHours !== undefined && row.regularHours === undefined
              ? `${row.weeklyHours} weekly hours; `
              : ""}
            {row.hourlyRate !== undefined
              ? `${formatCurrencyForUi(row.hourlyRate)} hourly rate`
              : ""}
          </li>
        ))}
      </ul>
      {details.conflicts.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs text-amber-950">
          <p className="font-semibold">Original sources disagree</p>
          <ul className="mt-1 list-disc pl-4">
            {details.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <CanonicalInput
          label="Weekly hours"
          value={draft.weeklyHours ?? ""}
          onChange={(v) => update("weeklyHours", v)}
        />
        <CanonicalInput
          label="Hourly rate"
          value={draft.hourlyRate ?? ""}
          onChange={(v) => update("hourlyRate", v)}
        />
        <CanonicalInput
          label="Regular hours"
          value={draft.regularHours ?? ""}
          onChange={(v) => update("regularHours", v)}
        />
        <CanonicalInput
          label="Gross pay"
          value={draft.grossPay ?? ""}
          onChange={(v) => update("grossPay", v)}
        />
        <CanonicalInput
          label="Net pay"
          value={draft.netPay ?? ""}
          onChange={(v) => update("netPay", v)}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Using: {draft.weeklyHours || "unknown"} weekly hours at {draft.hourlyRate || "unknown"}.
        Duplicate source values will not affect calculation unless saved here.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={save}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Save values for this income source
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(details.suggested);
            onSave(undefined);
          }}
          className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Revert to original/source value
        </button>
      </div>
    </div>
  );
}

function CanonicalInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function parseMoneyish(value: string): number {
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function formatCurrencyForUi(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex min-h-[3.25rem] items-center justify-center rounded-md border px-4 py-3 text-center text-sm font-semibold leading-snug text-balance focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <dl className="divide-y divide-border rounded-xl border bg-card">{children}</dl>
    </section>
  );
}

function EmptyRow() {
  return <div className="px-4 py-3 text-sm text-muted-foreground">No values in this section.</div>;
}

function Row({
  merged,
  fields,
  onEdited,
}: {
  merged: MergedField;
  fields: ReturnType<typeof allFields>;
  onEdited: (msg: string) => void;
}) {
  // Bind edits to the first underlying field so EditableValue keeps working.
  const primary = fields.find((f) => f.id === merged.sources[0]?.fieldId);
  const originalValue = merged.sources[0]?.value ?? merged.displayValue;
  const currentValue = merged.corrected ?? merged.displayValue;
  const wasCorrected = currentValue !== originalValue;
  return (
    <div
      id={`field-key-${merged.key}`}
      tabIndex={-1}
      className="scroll-mt-24 grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <dt className="text-sm font-medium text-muted-foreground">{merged.label}</dt>
      <dd className="min-w-0">
        {primary ? (
          <EditableValue
            field={{ ...primary, corrected: merged.corrected, value: merged.displayValue }}
            size="sm"
            onSaved={(v) =>
              onEdited(`${merged.label} updated to ${v}. Calculations will use this value.`)
            }
          />
        ) : (
          <span className="text-sm font-semibold">{merged.displayValue}</span>
        )}
        {wasCorrected && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Original: <span className="line-through">{originalValue}</span> → {currentValue}
          </p>
        )}
        {merged.isOld && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-800">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Source older than 6 months
          </p>
        )}
      </dd>
      <dd className="justify-self-end">
        {merged.confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            <Check className="h-3 w-3" aria-hidden="true" />
            Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Not confirmed
          </span>
        )}
      </dd>
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
