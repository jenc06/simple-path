import type { ExtractedField } from "@/lib/session-store";

/**
 * Simulated document preview with a yellow highlight box where the value was
 * extracted. Uses text + a border pattern (not color alone) so it's readable
 * for color-blind users and screen readers.
 */
export function DocPreview({ field }: { field: ExtractedField }) {
  return (
    <figure
      className="overflow-hidden rounded-lg border bg-muted/40"
      aria-label={`Document preview for ${field.label}, page ${field.sourcePage}`}
    >
      <div className="border-b bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
        Page {field.sourcePage}
      </div>
      <div className="relative aspect-[3/4] w-full bg-white text-[10px] leading-tight text-slate-700 sm:text-xs">
        {/* Fake document lines */}
        <div className="absolute inset-0 p-4 space-y-1.5">
          {Array.from({ length: 22 }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded bg-slate-200"
              style={{ width: `${40 + ((i * 13) % 55)}%` }}
            />
          ))}
        </div>
        {/* Highlight box */}
        <div
          className="absolute rounded-sm border-2 border-dashed border-amber-500 bg-amber-300/40 ring-2 ring-amber-500/20"
          style={{
            left: `${field.bbox.x}%`,
            top: `${field.bbox.y}%`,
            width: `${field.bbox.w}%`,
            height: `${field.bbox.h}%`,
          }}
          aria-hidden="true"
        >
          <span className="absolute -top-5 left-0 rounded-sm bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Found here
          </span>
        </div>
      </div>
    </figure>
  );
}
