import { Pencil, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSession, type ExtractedField } from "@/lib/session-store";

interface Props {
  field: ExtractedField;
  /** Visual size of the value text */
  size?: "sm" | "md" | "lg" | "xl";
  /** Called after a successful save with the new value */
  onSaved?: (newValue: string) => void;
  /** Optional label to include in announcements (defaults to field.label) */
  ariaLabel?: string;
}

const sizeClass = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-lg font-semibold",
  xl: "text-3xl font-bold tracking-tight",
};

/**
 * Inline-editable value.
 * - Click "Edit" button, or focus the value and press Enter / F2, to edit.
 * - Enter saves, Escape cancels.
 * - Fully keyboard + screen reader accessible; also works on mobile via the
 *   visible pencil button (no reliance on double-click / right-click gestures).
 */
export function EditableValue({ field, size = "md", onSaved, ariaLabel }: Props) {
  const { confirmField } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const current = field.corrected ?? field.value;
  const wasCorrected = !!field.corrected && field.corrected !== field.value;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    setDraft(current);
    setError("");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError("");
    setDraft("");
  }

  function save() {
    const next = draft.trim();
    if (!next) {
      setError("Value cannot be empty.");
      return;
    }
    if (next === current) {
      cancel();
      return;
    }
    confirmField(field.id, next);
    setAnnouncement(`${field.label} changed from ${current} to ${next}.`);
    onSaved?.(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="w-full">
        <label htmlFor={`edit-${field.id}`} className="sr-only">
          Edit {field.label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`edit-${field.id}`}
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `edit-${field.id}-error` : undefined}
            className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={save}
            aria-label={`Save new value for ${ariaLabel ?? field.label}`}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={`Cancel editing ${ariaLabel ?? field.label}`}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </button>
        </div>
        {error && (
          <p
            id={`edit-${field.id}-error`}
            role="alert"
            className="mt-1 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to save, Escape to cancel.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={sizeClass[size]}
          tabIndex={0}
          role="button"
          aria-label={`${ariaLabel ?? field.label}: ${current}. Press Enter to edit.`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              startEdit();
            }
          }}
          onDoubleClick={startEdit}
          className={`${sizeClass[size]} cursor-text rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        >
          {current}
        </span>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`Edit ${ariaLabel ?? field.label} (currently ${current})`}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </button>
      </div>
      {wasCorrected && (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Changed</span> from{" "}
          <span className="line-through">{field.value}</span> to{" "}
          <span className="font-semibold text-foreground">{field.corrected}</span>
        </p>
      )}
      {/* Screen reader announcement for edits */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
