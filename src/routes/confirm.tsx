import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { DOC_LABELS, allFields, useSession } from "@/lib/session-store";

export const Route = createFileRoute("/confirm")({
  head: () => ({
    meta: [{ title: "Final confirmation — Income Check" }],
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

      <ul className="mt-5 space-y-2">
        {fields.map((f) => {
          const isOpen = open === f.id;
          const shown = f.corrected ?? f.value;
          return (
            <li key={f.id} className="rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : f.id)}
                aria-expanded={isOpen}
                aria-controls={`panel-${f.id}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {f.label}
                  </span>
                  <span className="mt-0.5 block text-lg font-semibold">{shown}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    From {DOC_LABELS[f.sourceDoc]}, page {f.sourcePage}
                    {f.corrected ? " • You corrected this" : ""}
                  </span>
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
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
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
