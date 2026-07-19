import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { UntrustedCard } from "@/components/untrusted-card";
import { MergedValueCard } from "@/components/merged-value-card";
import { IncomeSourceTimeline } from "@/components/income-source-timeline";
import { validateNumericField } from "@/lib/income-validation";
import { PENDING_FIELD_FOCUS_KEY } from "@/lib/chat-guardrails";
import {
  DOC_LABELS,
  detectIncomeSourceReviews,
  mergedFields,
  sameIncomeSourceCanonicalReview,
  useSession,
  type CanonicalIncomeSourceValues,
  type ExtractedField,
  type IncomeSourceReview,
  type IncomeSourceReviewChoice,
  type MergedField,
  type MergedSource,
  type SessionState,
  type UploadedDoc,
} from "@/lib/session-store";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review values — SimplePath" },
      {
        name: "description",
        content:
          "Confirm each extracted value one at a time. Basic info first, then values used for calculation.",
      },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { session, resolveIncomeSourceReview, updateIncomeSourceCanonical } = useSession();
  const navigate = useNavigate();

  const merged = useMemo(() => mergedFields(session), [session]);
  const incomeReviews = useMemo(() => detectIncomeSourceReviews(session), [session]);

  // Preserve original order — confirmed cards stay in place; we just auto-scroll to the next unconfirmed one.
  const orderedBasic = useMemo(() => merged.filter((m) => m.category === "basic"), [merged]);
  const orderedCalc = useMemo(() => merged.filter((m) => m.category === "calculation"), [merged]);

  const basicDone = orderedBasic.every((m) => m.confirmed);
  const calcDone = orderedCalc.every((m) => m.confirmed);
  const totalCards = orderedBasic.length + orderedCalc.length;
  const confirmedCount =
    orderedBasic.filter((m) => m.confirmed).length + orderedCalc.filter((m) => m.confirmed).length;
  const allDone = totalCards > 0 && confirmedCount === totalCards;
  const unresolvedIncomeReviews = incomeReviews.filter((review) => !review.choice).length;
  const unresolvedCanonicalReviews = incomeReviews.filter(
    (review) => sameIncomeSourceCanonicalReview(session, review).requiresCanonicalConfirmation,
  ).length;

  const firstPending =
    orderedBasic.find((m) => !m.confirmed) ??
    orderedCalc.find((m) => !m.confirmed) ??
    orderedBasic[0] ??
    orderedCalc[0];

  const [activeKey, setActiveKey] = useState<string | null>(
    firstPending ? mkKey(firstPending) : null,
  );
  const [activeSourceByKey, setActiveSourceByKey] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const basicHeader = useRef<HTMLHeadingElement>(null);
  const calcHeader = useRef<HTMLHeadingElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!firstPending) return;
    const available = [...orderedBasic, ...orderedCalc].some((m) => mkKey(m) === activeKey);
    if (!activeKey || !available) setActiveKey(mkKey(firstPending));
  }, [activeKey, firstPending, orderedBasic, orderedCalc]);

  const activeMerged: MergedField | undefined = useMemo(() => {
    if (!activeKey) return undefined;
    return [...orderedBasic, ...orderedCalc].find((m) => mkKey(m) === activeKey);
  }, [activeKey, orderedBasic, orderedCalc]);

  const activeSource: MergedSource | undefined = useMemo(() => {
    if (!activeMerged) return undefined;
    const chosenId = activeSourceByKey[mkKey(activeMerged)];
    return (
      activeMerged.sources.find((s) => s.fieldId === chosenId) ??
      [...activeMerged.sources].sort((a, b) => b.confidence - a.confidence)[0]
    );
  }, [activeMerged, activeSourceByKey]);

  // When the active card gets confirmed, advance to next unconfirmed and
  // auto-scroll to the next section if we finished a category.
  const prevBasicDone = useRef(basicDone);
  useEffect(() => {
    if (!basicDone) {
      prevBasicDone.current = false;
      return;
    }
    if (!prevBasicDone.current && basicDone && !calcDone) {
      // just finished basic
      setAnnouncement("Basic values complete. Moving to values used for calculation.");
      const next = orderedCalc.find((m) => !m.confirmed);
      if (next) setActiveKey(mkKey(next));
      calcHeader.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevBasicDone.current = basicDone;
  }, [basicDone, calcDone, orderedCalc]);

  useEffect(() => {
    // If the active card became confirmed, advance
    if (!activeMerged || !activeMerged.confirmed) return;
    const next = orderedBasic.find((m) => !m.confirmed) ?? orderedCalc.find((m) => !m.confirmed);
    if (next) setActiveKey(mkKey(next));
  }, [activeMerged, orderedBasic, orderedCalc]);

  useEffect(() => {
    // Scroll active card into view when it changes.
    activeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeKey]);

  useEffect(() => {
    const pending = readPendingFieldFocus("/review");
    if (!pending) return;
    const target = [...orderedBasic, ...orderedCalc].find((m) => m.key === pending.fieldKey);
    if (!target) return;
    const key = mkKey(target);
    setActiveKey(key);
    setAnnouncement(`${target.label} is ready on the Review page.`);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`field-key-${target.key}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
    });
  }, [orderedBasic, orderedCalc]);

  function handleConfirmed(m: MergedField) {
    setAnnouncement(
      `${m.label} confirmed. ${Math.min(confirmedCount + 1, totalCards)} of ${totalCards} values done.`,
    );
  }

  function handleSourceChange(m: MergedField, s: MergedSource) {
    setActiveSourceByKey((prev) => ({ ...prev, [mkKey(m)]: s.fieldId }));
  }

  // Untrusted fields — always visible in Safety check, per doc.
  const uploadedDocs = session.docs.filter((d) => d.status !== "skipped");
  const untrusted: ExtractedField[] = uploadedDocs.flatMap((d) =>
    d.fields
      .filter((f) => f.category === "untrusted")
      .map((f) => ({ ...f, previewImage: d.previewPages?.[f.sourcePage] })),
  );

  if (totalCards === 0) {
    return (
      <PageShell title="Nothing to review" step="Review">
        <p className="text-sm text-muted-foreground">
          There are no extracted values yet. Add a document to continue.
        </p>
        <button
          type="button"
          onClick={() => navigate({ to: "/upload" })}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to upload
        </button>
      </PageShell>
    );
  }

  const activeUntrusted: ExtractedField | undefined = activeKey?.startsWith("untrusted::")
    ? untrusted.find((f) => `untrusted::${f.id}` === activeKey)
    : undefined;

  const previewField: ExtractedField | undefined = activeUntrusted
    ? activeUntrusted
    : activeMerged && activeSource
      ? {
          id: activeSource.fieldId,
          key: activeMerged.key,
          label: activeMerged.label,
          value: activeSource.value,
          confidence: activeSource.confidence,
          sourceDoc: activeSource.docType,
          sourcePage: activeSource.page,
          bbox: activeSource.bbox,
          previewImage: activeSource.previewImage,
          confirmed: activeMerged.confirmed,
          category: activeMerged.category,
        }
      : undefined;

  return (
    <PageShell
      title="Review extracted values"
      step={`${confirmedCount} of ${totalCards} confirmed`}
      wide
    >
      <LiveRegion message={announcement} />

      {/* Progress bar */}
      <div
        className="mb-3"
        role="progressbar"
        aria-valuenow={confirmedCount}
        aria-valuemin={0}
        aria-valuemax={totalCards}
        aria-label={`${confirmedCount} of ${totalCards} values confirmed`}
      >
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${totalCards ? (confirmedCount / totalCards) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {previewField && (
          <aside className="rounded-lg border bg-card p-3 lg:sticky lg:top-20 lg:min-h-[calc(100vh-150px)]">
            <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {activeUntrusted ? "Safety item" : "Source preview"}
                </p>
                <p className="truncate text-sm font-semibold">
                  {activeUntrusted ? "Suspicious instruction" : activeMerged?.label}
                </p>
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">
                {DOC_LABELS[previewField.sourceDoc]}, page {previewField.sourcePage}
              </p>
            </div>
            <div className="mt-3 max-h-[64vh] overflow-auto rounded-lg lg:max-h-[calc(100vh-235px)]">
              <DocPreview field={previewField} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Dashed box marks where it was found.
            </p>
          </aside>
        )}

        <div className="min-w-0 space-y-6 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-1">
          {incomeReviews.length > 0 && (
            <section aria-labelledby="income-source-review">
              <h2 id="income-source-review" className="mb-2 text-lg font-semibold">
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

          {orderedBasic.length > 0 && (
            <section aria-labelledby="section-basic">
              <h2 ref={basicHeader} id="section-basic" className="mb-1 text-lg font-semibold">
                Basic values
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Applicant identity and household details. Confirm each value or edit it — the
                highlighted box on the left shows where it was found.
              </p>
              <div className="space-y-2.5">
                {orderedBasic.map((m) => {
                  const key = mkKey(m);
                  const src =
                    m.sources.find((s) => s.fieldId === activeSourceByKey[key]) ??
                    [...m.sources].sort((a, b) => b.confidence - a.confidence)[0];
                  const isActive = activeKey === key;
                  return (
                    <div
                      key={key}
                      id={`field-key-${m.key}`}
                      ref={isActive ? activeCardRef : undefined}
                      tabIndex={-1}
                      className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <MergedValueCard
                        merged={m}
                        isActive={isActive}
                        onActivate={() => setActiveKey(key)}
                        onConfirmed={() => handleConfirmed(m)}
                        activeSource={src}
                        onSourceChange={(s) => handleSourceChange(m, s)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {orderedCalc.length > 0 && (
            <section aria-labelledby="section-calc">
              <h2 ref={calcHeader} id="section-calc" className="mb-1 text-lg font-semibold">
                Values used for calculation
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Numbers that determine annual income. Confirm each one; changes update the totals
                on the next page.
              </p>
              <div className="space-y-2.5">
                {orderedCalc.map((m) => {
                  const key = mkKey(m);
                  const src =
                    m.sources.find((s) => s.fieldId === activeSourceByKey[key]) ??
                    [...m.sources].sort((a, b) => b.confidence - a.confidence)[0];
                  const isActive = activeKey === key;
                  return (
                    <div
                      key={key}
                      id={`field-key-${m.key}`}
                      ref={isActive ? activeCardRef : undefined}
                      tabIndex={-1}
                      className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <MergedValueCard
                        merged={m}
                        isActive={isActive}
                        onActivate={() => setActiveKey(key)}
                        onConfirmed={() => handleConfirmed(m)}
                        activeSource={src}
                        onSourceChange={(s) => handleSourceChange(m, s)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {untrusted.length > 0 && (
            <section aria-labelledby="section-safety">
              <h2 id="section-safety" className="mb-2 text-lg font-semibold">
                Safety check
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Suspicious text is shown only for transparency. SimplePath ignores it.
              </p>
              <div className="space-y-2.5">
                {untrusted.map((f) => {
                  const uKey = `untrusted::${f.id}`;
                  const isActive = activeKey === uKey;
                  return (
                    <div key={f.id} ref={isActive ? activeCardRef : undefined}>
                      <UntrustedCard
                        field={f}
                        isActive={isActive}
                        onActivate={() => setActiveKey(uKey)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="border-t pt-5">
            <button
              type="button"
              onClick={() => {
                setAnnouncement("All values reviewed. Going to final confirmation.");
                navigate({ to: "/confirm" });
              }}
              disabled={!allDone || unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0}
              aria-disabled={
                !allDone || unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0
              }
              aria-describedby={
                !allDone || unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0
                  ? "review-not-allowed"
                  : undefined
              }
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {unresolvedCanonicalReviews > 0
                ? "Not allowed - save same income source values"
                : unresolvedIncomeReviews > 0
                  ? "Not allowed - review income source question"
                  : allDone
                    ? "Continue to final confirmation"
                    : `Not allowed - confirm all values to continue (${totalCards - confirmedCount} left)`}
            </button>
            {(!allDone || unresolvedIncomeReviews > 0 || unresolvedCanonicalReviews > 0) && (
              <p id="review-not-allowed" className="mt-2 text-xs font-medium text-amber-800">
                Not allowed yet: finish every required value, income source question, and
                same-source canonical value first.
              </p>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function mkKey(m: MergedField) {
  return m.mergeId;
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
    <article className="rounded-lg border bg-card p-4">
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
        "inline-flex h-11 items-center justify-center rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}
