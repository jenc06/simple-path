import { Check, Pencil, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateNumericField } from "@/lib/income-validation";
import { DOC_LABELS, useSession, type ExtractedField } from "@/lib/session-store";

interface Props {
  field: ExtractedField;
  isActive: boolean;
  onActivate: () => void;
  onConfirmed: () => void;
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

export function ValueCard({ field, isActive, onActivate, onConfirmed }: Props) {
  const { confirmField } = useSession();
  const initial = field.corrected ?? field.value;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [reopen, setReopen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tier = confidenceTier(field.confidence);
  const edited = draft.trim() !== field.value;

  useEffect(() => {
    if (!field.confirmed) setDraft(field.corrected ?? field.value);
  }, [field.confirmed, field.corrected, field.value]);

  function confirm() {
    const next = draft.trim();
    if (!next) {
      setError("Value cannot be empty. Type the correct value or reset to the found value.");
      inputRef.current?.focus();
      return;
    }
    const validation = validateNumericField(field.key, next);
    if (!validation.ok) {
      setError(validation.error ?? "Value is not valid.");
      inputRef.current?.focus();
      return;
    }
    const savedValue = validation.normalized ?? next;
    setError("");
    confirmField(field.id, savedValue === field.value ? undefined : savedValue);
    onConfirmed();
  }

  function reset() {
    setDraft(field.value);
    setError("");
    inputRef.current?.focus();
  }

  if (field.confirmed) {
    const shown = field.corrected ?? field.value;
    const wasCorrected = !!field.corrected && field.corrected !== field.value;
    return (
      <article
        onClick={onActivate}
        className={
          "rounded-xl border bg-card p-4 transition " +
          (isActive ? "ring-2 ring-primary" : "hover:border-primary/40")
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {field.label}
            </h3>
            <p className="mt-1 truncate text-lg font-semibold">{shown}</p>
            {wasCorrected && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Changed from <span className="line-through">{field.value}</span>
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
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Edit ${field.label} (currently ${shown})`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
            {wasCorrected && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmField(field.id, undefined);
                  onConfirmed();
                }}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Revert ${field.label} to original value ${field.value}`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Revert
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Source: {DOC_LABELS[field.sourceDoc]}, page {field.sourcePage} · Location: highlighted box
        </p>
        {reopen && (
          <ReopenEditor field={field} onDone={() => setReopen(false)} onConfirmed={onConfirmed} />
        )}
      </article>
    );
  }

  return (
    <article
      onClick={onActivate}
      className={
        "overflow-hidden rounded-xl border bg-card transition " +
        (isActive ? "ring-2 ring-primary" : "hover:border-primary/40")
      }
    >
      <div className={"h-1 w-full " + tier.topBar} aria-hidden="true" />
      <div className="p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{field.label}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Found value: <span className="font-medium text-foreground">{field.value}</span>
            </p>
          </div>
          <span
            className={
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold " +
              tier.chip
            }
            aria-label={`Confidence ${tier.word}, ${field.confidence} percent`}
          >
            {tier.word} · {field.confidence}%
          </span>
        </div>

        <div className="mt-3">
          <label htmlFor={`v-${field.id}`} className="sr-only">
            Correct value for {field.label}
          </label>
          <input
            ref={inputRef}
            id={`v-${field.id}`}
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
            aria-describedby={error ? `v-${field.id}-err` : undefined}
            className="h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error && (
            <p
              id={`v-${field.id}-err`}
              role="alert"
              className="mt-1 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={confirm}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={
              edited
                ? `Confirm corrected value ${draft.trim()} for ${field.label}`
                : `Use found value ${field.value} for ${field.label}`
            }
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {edited ? "Confirm correct value" : "Yes, use this"}
          </button>
          {edited && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Reset to found value ${field.value}`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to found value ({field.value})
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Source: {DOC_LABELS[field.sourceDoc]}, page {field.sourcePage} · Location: highlighted box
        </p>
      </div>
    </article>
  );
}

function ReopenEditor({
  field,
  onDone,
  onConfirmed,
}: {
  field: ExtractedField;
  onDone: () => void;
  onConfirmed: () => void;
}) {
  const { confirmField } = useSession();
  const [draft, setDraft] = useState(field.corrected ?? field.value);
  const [error, setError] = useState("");

  function save() {
    const next = draft.trim();
    if (!next) {
      setError("Value cannot be empty.");
      return;
    }
    const validation = validateNumericField(field.key, next);
    if (!validation.ok) {
      setError(validation.error ?? "Value is not valid.");
      return;
    }
    const savedValue = validation.normalized ?? next;
    confirmField(field.id, savedValue === field.value ? undefined : savedValue);
    onConfirmed();
    onDone();
  }

  return (
    <div className="mt-3 rounded-md border bg-background p-3">
      <label htmlFor={`re-${field.id}`} className="block text-xs font-medium">
        Change {field.label}
      </label>
      <input
        id={`re-${field.id}`}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        aria-invalid={!!error}
        className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={save}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Check className="h-4 w-4" aria-hidden="true" /> Save
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
