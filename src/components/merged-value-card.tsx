import { AlertTriangle, Check, Pencil, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateNumericField } from "@/lib/income-validation";
import { DOC_LABELS, useSession, type MergedField, type MergedSource } from "@/lib/session-store";

interface Props {
  merged: MergedField;
  isActive: boolean;
  onActivate: () => void;
  onConfirmed: () => void;
  activeSource: MergedSource;
  onSourceChange: (src: MergedSource) => void;
}

function confidenceTier(conf: number) {
  if (conf >= 90)
    return {
      word: "High",
      chip: "border-emerald-600/40 bg-emerald-50 text-emerald-800",
      topBar: "bg-emerald-500",
    };
  if (conf >= 70)
    return {
      word: "Medium",
      chip: "border-amber-600/40 bg-amber-50 text-amber-900",
      topBar: "bg-amber-500",
    };
  return {
    word: "Low",
    chip: "border-red-600/40 bg-red-50 text-red-800",
    topBar: "bg-red-500",
  };
}

export function MergedValueCard({
  merged,
  isActive,
  onActivate,
  onConfirmed,
  activeSource,
  onSourceChange,
}: Props) {
  const { confirmMerged } = useSession();
  const initial = merged.corrected ?? merged.displayValue;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [reopen, setReopen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tier = confidenceTier(activeSource.confidence);
  const edited = draft.trim() !== merged.displayValue;

  useEffect(() => {
    if (!merged.confirmed) setDraft(merged.corrected ?? merged.displayValue);
  }, [merged.confirmed, merged.corrected, merged.displayValue]);

  function confirm() {
    const next = draft.trim();
    if (!next) {
      setError("Value cannot be empty. Type the correct value or reset to the found value.");
      inputRef.current?.focus();
      return;
    }
    const validation = validateNumericField(merged.key, next);
    if (!validation.ok) {
      setError(validation.error ?? "Value is not valid.");
      inputRef.current?.focus();
      return;
    }
    const savedValue = validation.normalized ?? next;
    setError("");
    const corrected = savedValue === merged.displayValue ? undefined : savedValue;
    confirmMerged(merged.mergeId, corrected);
    onConfirmed();
  }

  function reset() {
    setDraft(merged.displayValue);
    setError("");
    inputRef.current?.focus();
  }

  const hasMulti = merged.sources.length > 1;
  const originalValue = merged.sources[0]?.value ?? merged.displayValue;
  const currentValue = merged.corrected ?? merged.displayValue;
  const wasCorrected = currentValue !== originalValue;

  // Confirmed collapsed view
  if (merged.confirmed && !reopen) {
    return (
      <article
        onClick={onActivate}
        className={
          "rounded-lg border bg-card p-3 transition " +
          (isActive ? "ring-2 ring-primary" : "hover:border-primary/40")
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {merged.label}
            </h3>
            <p className="mt-0.5 truncate text-base font-semibold">{currentValue}</p>
            {wasCorrected && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Original: <span className="line-through">{originalValue}</span> → {currentValue}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              <Check className="h-3 w-3" aria-hidden="true" />
              Confirmed
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
                setReopen(true);
              }}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Edit ${merged.label} (currently ${merged.displayValue})`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
            {wasCorrected && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmMerged(merged.mergeId, undefined);
                  onConfirmed();
                }}
                className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Revert ${merged.label} to original value ${originalValue}`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Revert
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {merged.sources.length === 1
            ? `Source: ${DOC_LABELS[merged.sources[0].docType]}, page ${merged.sources[0].page}`
            : `Sources: ${merged.sources.map((s) => DOC_LABELS[s.docType]).join(", ")}`}
        </p>
      </article>
    );
  }

  return (
    <article
      onClick={onActivate}
      className={
        "overflow-hidden rounded-lg border bg-card transition " +
        (isActive ? "ring-2 ring-primary" : "hover:border-primary/40")
      }
    >
      <div className={"h-1 w-full " + tier.topBar} aria-hidden="true" />
      <div className="p-4">
        {merged.isOld && (
          <div
            role="note"
            className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-2.5 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              <span className="font-semibold">Older than 6 months</span> — double-check this is
              still current before continuing.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{merged.label}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Found value:{" "}
              <span className="font-medium text-foreground">{merged.displayValue}</span>
            </p>
          </div>
          <span
            className={
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold " +
              tier.chip
            }
            aria-label={`Confidence ${tier.word}, ${activeSource.confidence} percent`}
          >
            {tier.word} · {activeSource.confidence}%
          </span>
        </div>

        {hasMulti && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Found in {merged.sources.length} documents
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label={`Sources for ${merged.label}`}
            >
              {merged.sources.map((s) => {
                const active = s.fieldId === activeSource.fieldId;
                return (
                  <button
                    key={s.fieldId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSourceChange(s);
                    }}
                    className={
                      "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent")
                    }
                  >
                    {DOC_LABELS[s.docType]} · p.{s.page}
                    {s.value !== merged.displayValue && (
                      <span
                        className="ml-1 rounded-sm bg-amber-200 px-1 text-[10px] font-semibold text-amber-900"
                        aria-label="different value in this source"
                      >
                        {s.value}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor={`v-${merged.mergeId}`} className="sr-only">
            Correct value for {merged.label}
          </label>
          <input
            ref={inputRef}
            id={`v-${merged.mergeId}`}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={onActivate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirm();
              }
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `v-${merged.mergeId}-err` : undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error && (
            <p
              id={`v-${merged.mergeId}-err`}
              role="alert"
              className="mt-1 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <button
            type="button"
            onClick={confirm}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={
              edited
                ? `Confirm corrected value ${draft.trim()} for ${merged.label}`
                : `Use found value ${merged.displayValue} for ${merged.label}`
            }
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {edited ? "Confirm correct value" : "Yes, use this"}
          </button>
          {edited && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
              aria-label={`Reset to found value ${merged.displayValue}`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to found value ({merged.displayValue})
            </button>
          )}
        </div>

        {wasCorrected && (
          <p className="mt-3 text-xs text-muted-foreground">
            Original: <span className="line-through">{originalValue}</span> → {currentValue}
          </p>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          Source: {DOC_LABELS[activeSource.docType]}, page {activeSource.page} · Location:
          highlighted box
        </p>

        {reopen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReopen(false);
            }}
            className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Cancel edit
          </button>
        )}
      </div>
    </article>
  );
}
