import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { ExtractedField } from "@/lib/session-store";

/**
 * Simulated document preview with a yellow highlight box where the value was
 * extracted. Uses text + a border pattern (not color alone) so it's readable
 * for color-blind users and screen readers.
 */
export function DocPreview({ field }: { field: ExtractedField }) {
  const [zoom, setZoom] = useState(1);
  const box = visibleBox(field.bbox);
  const zoomPct = Math.round(zoom * 100);

  return (
    <figure
      className="overflow-visible rounded-lg border bg-muted/40"
      aria-label={`Document preview for ${field.label}, page ${field.sourcePage}`}
    >
      <div className="flex items-start justify-between gap-3 border-b bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Page {field.sourcePage}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {field.label}: {field.value}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1" aria-label="Preview zoom controls">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Zoom out of source preview"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Zoom out</span>
          </button>
          <span className="w-12 text-center text-xs font-medium text-muted-foreground">
            {zoomPct}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Zoom in on source preview"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Zoom in</span>
          </button>
        </div>
      </div>
      <div
        className={
          "relative w-full bg-white text-[10px] leading-tight text-slate-700 sm:text-xs " +
          (field.previewImage ? "" : "aspect-[3/4]")
        }
      >
        <div
          className={"relative min-w-full " + (field.previewImage ? "" : "h-full")}
          style={{ width: `${zoomPct}%` }}
        >
          {field.previewImage ? (
            <img src={field.previewImage} alt="" className="block w-full" aria-hidden="true" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
              <p className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm font-medium text-amber-950">
                Real document preview is not available for this upload. Delete this document and
                upload it again with the server extractor running.
              </p>
            </div>
          )}
          {field.previewImage && (
            <div
              className="absolute rounded-[3px] border-2 border-sky-600 bg-sky-300/15 shadow-[0_0_0_3px_rgba(2,132,199,0.18)]"
              style={{
                left: `${box.x}%`,
                top: `${box.y}%`,
                width: `${box.w}%`,
                height: `${box.h}%`,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {field.previewImage && (
        <figcaption className="border-t bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
          {field.label} found here: <span className="text-foreground">{field.value}</span>
        </figcaption>
      )}
    </figure>
  );
}

function visibleBox(bbox: ExtractedField["bbox"]) {
  const w = clamp(Math.max(bbox.w, 5.5), 2, 92);
  const h = clamp(Math.max(bbox.h, 3), 2, 24);
  return {
    x: clamp(bbox.x, 0, 100 - w),
    y: clamp(bbox.y, 0, 100 - h),
    w,
    h,
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
