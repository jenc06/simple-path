import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { EditableValue } from "@/components/editable-value";
import { DOC_LABELS, allFields, useSession } from "@/lib/session-store";


export const Route = createFileRoute("/confirm")({
  head: () => ({
    meta: [{ title: "Final confirmation — RentSmooth" }],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { session } = useSession();
  const fields = useMemo(() => allFields(session), [session]);
  const [open, setOpen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const navigate = useNavigate();

  return (
    <PageShell title="Confirm your information" step="Final review">
      <LiveRegion message={announcement} />

      <p className="text-sm text-muted-foreground">
        Please look over everything below. Tap any value to see where it was found. Nothing is
        used until you confirm here.
      </p>

      <ul className="mt-5 space-y-3">
        {fields.map((f) => {
          const isOpen = open === f.id;
          return (
            <li key={f.id} className="rounded-xl border bg-card">
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {f.label}
                  </span>
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium " +
                      (f.confirmed
                        ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
                        : "border-amber-600/40 bg-amber-50 text-amber-900")
                    }
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {f.confirmed ? "Confirmed" : "Not confirmed"}
                  </span>
                </div>
                <EditableValue
                  field={f}
                  size="lg"
                  onSaved={(v) =>
                    setAnnouncement(`${f.label} updated to ${v}. Calculations will use this value.`)
                  }
                />
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : f.id)}
                  aria-expanded={isOpen}
                  aria-controls={`panel-${f.id}`}
                  className="mt-1 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isOpen ? "Hide source" : "Show source"} — {DOC_LABELS[f.sourceDoc]}, page {f.sourcePage}
                </button>
              </div>
              {isOpen && (
                <div id={`panel-${f.id}`} className="border-t px-4 py-4">
                  <DocPreview field={f} />
                </div>
              )}
            </li>
          );
        })}
      </ul>


      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setAnnouncement("All information confirmed. Continuing to calculation.");
            navigate({ to: "/calculation" });
          }}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Yes, this information is correct
        </button>
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
