import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { UntrustedCard } from "@/components/untrusted-card";
import { ValueCard } from "@/components/value-card";
import { DOC_LABELS, useSession, type ExtractedField } from "@/lib/session-store";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review values — RentSmooth" },
      {
        name: "description",
        content:
          "Confirm each extracted value. Edit any value inline, see where it was found, and skip nothing.",
      },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { session } = useSession();
  const navigate = useNavigate();

  const docs = session.docs.filter((d) => d.status !== "skipped" && d.fields.length > 0);

  const allTrusted = useMemo(
    () =>
      docs.flatMap((d) => d.fields).filter((f) => f.category !== "untrusted"),
    [docs],
  );
  const confirmedCount = allTrusted.filter((f) => f.confirmed).length;
  const total = allTrusted.length;
  const allDone = total > 0 && confirmedCount === total;

  // First unconfirmed field becomes active by default.
  const firstPending = allTrusted.find((f) => !f.confirmed);
  const [activeId, setActiveId] = useState<string | null>(firstPending?.id ?? allTrusted[0]?.id ?? null);
  const [announcement, setAnnouncement] = useState("");

  const activeField: ExtractedField | undefined = useMemo(
    () => docs.flatMap((d) => d.fields).find((f) => f.id === activeId),
    [docs, activeId],
  );

  // If the currently active field just got confirmed, advance to the next pending one.
  useEffect(() => {
    if (!activeField) return;
    if (activeField.confirmed) {
      const next = allTrusted.find((f) => !f.confirmed);
      if (next) setActiveId(next.id);
    }
  }, [activeField, allTrusted]);

  function handleConfirmed(field: ExtractedField) {
    setAnnouncement(
      `${field.label} confirmed. ${Math.min(confirmedCount + 1, total)} of ${total} values done.`,
    );
  }

  if (total === 0) {
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

  return (
    <PageShell title="Review extracted values" step={`${confirmedCount} of ${total} confirmed`}>
      <LiveRegion message={announcement} />

      {/* Progress bar */}
      <div
        className="mb-3"
        role="progressbar"
        aria-valuenow={confirmedCount}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${confirmedCount} of ${total} values confirmed`}
      >
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${total ? (confirmedCount / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Sticky preview */}
      {activeField && (
        <div className="sticky top-[64px] z-20 -mx-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Currently reviewing
          </p>
          <p className="text-sm font-semibold">
            {activeField.label}{" "}
            <span className="font-normal text-muted-foreground">
              — {DOC_LABELS[activeField.sourceDoc]}, page {activeField.sourcePage}
            </span>
          </p>
          <div className="mt-2 max-h-[38vh] overflow-hidden">
            <DocPreview field={activeField} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Yellow box shows where this value was found.
          </p>
        </div>
      )}

      {/* Per-document sections */}
      <div className="space-y-8">
        {docs.map((doc) => {
          const basic = doc.fields.filter((f) => f.category === "basic");
          const calc = doc.fields.filter((f) => f.category === "calculation");
          const untrusted = doc.fields.filter((f) => f.category === "untrusted");
          return (
            <section key={doc.id} aria-labelledby={`doc-${doc.id}`}>
              <div className="mb-3">
                <h2 id={`doc-${doc.id}`} className="text-lg font-semibold">
                  {DOC_LABELS[doc.type]}
                </h2>
                <p className="text-xs text-muted-foreground">{doc.fileName}</p>
              </div>

              {basic.length > 0 && (
                <div className="mb-5">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Basic values
                  </h3>
                  <div className="space-y-3">
                    {basic.map((f) => (
                      <ValueCard
                        key={f.id}
                        field={f}
                        isActive={activeId === f.id}
                        onActivate={() => setActiveId(f.id)}
                        onConfirmed={() => handleConfirmed(f)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {calc.length > 0 && (
                <div className="mb-5">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Values used for calculation
                  </h3>
                  <div className="space-y-3">
                    {calc.map((f) => (
                      <ValueCard
                        key={f.id}
                        field={f}
                        isActive={activeId === f.id}
                        onActivate={() => setActiveId(f.id)}
                        onConfirmed={() => handleConfirmed(f)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {untrusted.length > 0 && (
                <div className="mb-2">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Safety check
                  </h3>
                  <div className="space-y-3">
                    {untrusted.map((f) => (
                      <UntrustedCard
                        key={f.id}
                        field={f}
                        isActive={activeId === f.id}
                        onActivate={() => setActiveId(f.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Continue */}
      <div className="mt-8 border-t pt-5">
        <button
          type="button"
          onClick={() => {
            setAnnouncement("All values reviewed. Going to final confirmation.");
            navigate({ to: "/confirm" });
          }}
          disabled={!allDone}
          aria-disabled={!allDone}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allDone
            ? "Continue to final confirmation"
            : `Confirm all values to continue (${total - confirmedCount} left)`}
        </button>
      </div>
    </PageShell>
  );
}
