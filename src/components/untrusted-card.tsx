import { ShieldAlert } from "lucide-react";
import { DOC_LABELS, type ExtractedField } from "@/lib/session-store";

/**
 * Displays a detected prompt-injection / suspicious instruction inside a
 * user-supplied document. Non-editable, clearly labeled in text (not just
 * color) so it works for color-blind and screen-reader users.
 */
export function UntrustedCard({
  field,
  isActive,
  onActivate,
}: {
  field: ExtractedField;
  isActive: boolean;
  onActivate: () => void;
}) {
  return (
    <article
      onClick={onActivate}
      className={
        "overflow-hidden rounded-xl border-2 border-red-600 bg-red-50/60 transition " +
        (isActive ? "ring-2 ring-red-600 ring-offset-2" : "")
      }
      aria-labelledby={`u-${field.id}-title`}
    >
      <div className="flex items-center gap-2 border-b border-red-200 bg-red-100 px-4 py-2">
        <ShieldAlert className="h-4 w-4 text-red-800" aria-hidden="true" />
        <p id={`u-${field.id}-title`} className="text-sm font-semibold text-red-900">
          Suspicious instruction detected — this will be ignored
        </p>
      </div>
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-red-900/80">
          Text found in your document
        </p>
        <p className="mt-1 rounded-md border border-red-200 bg-white p-3 font-mono text-sm text-red-900">
          {field.value}
        </p>
        <p className="mt-3 text-xs text-red-900/80">
          RentSmooth never follows instructions written inside uploaded documents.
          Only your confirmed values are used for calculations.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Source: {DOC_LABELS[field.sourceDoc]}, page {field.sourcePage} · Location: highlighted box
        </p>
      </div>
    </article>
  );
}
