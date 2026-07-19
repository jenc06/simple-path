import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { UntrustedCard } from "@/components/untrusted-card";
import { MergedValueCard } from "@/components/merged-value-card";
import {
  DOC_LABELS,
  mergedFields,
  useSession,
  type ExtractedField,
  type MergedField,
  type MergedSource,
} from "@/lib/session-store";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review values — RentSmooth" },
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
  const { session } = useSession();
  const navigate = useNavigate();

  const merged = useMemo(() => mergedFields(session), [session]);

  // Preserve original order — confirmed cards stay in place; we just auto-scroll to the next unconfirmed one.
  const orderedBasic = useMemo(() => merged.filter((m) => m.category === "basic"), [merged]);
  const orderedCalc = useMemo(() => merged.filter((m) => m.category === "calculation"), [merged]);

  const basicDone = orderedBasic.every((m) => m.confirmed);
  const calcDone = orderedCalc.every((m) => m.confirmed);
  const totalCards = orderedBasic.length + orderedCalc.length;
  const confirmedCount =
    orderedBasic.filter((m) => m.confirmed).length +
    orderedCalc.filter((m) => m.confirmed).length;
  const allDone = totalCards > 0 && confirmedCount === totalCards;

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
    const next =
      orderedBasic.find((m) => !m.confirmed) ??
      orderedCalc.find((m) => !m.confirmed);
    if (next) setActiveKey(mkKey(next));
  }, [activeMerged, orderedBasic, orderedCalc]);

  useEffect(() => {
    // Scroll active card into view when it changes.
    activeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeKey]);

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
    d.fields.filter((f) => f.category === "untrusted"),
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

  const activeUntrusted: ExtractedField | undefined =
    activeKey?.startsWith("untrusted::")
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
          confirmed: activeMerged.confirmed,
          category: activeMerged.category,
        }
      : undefined;

  return (
    <PageShell title="Review extracted values" step={`${confirmedCount} of ${totalCards} confirmed`}>
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

      {/* Sticky preview */}
      {previewField && (
        <div className="sticky top-[64px] z-20 -mx-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {activeUntrusted ? "Currently viewing (suspicious — ignored)" : "Currently reviewing"}
          </p>
          <p className="text-sm font-semibold">
            {activeUntrusted ? "Suspicious instruction" : activeMerged?.label}{" "}
            <span className="font-normal text-muted-foreground">
              — {DOC_LABELS[previewField.sourceDoc]}, page {previewField.sourcePage}
            </span>
          </p>
          <div className="mt-2 max-h-[38vh] overflow-hidden">
            <DocPreview field={previewField} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Yellow box shows where this {activeUntrusted ? "text" : "value"} was found.
          </p>
        </div>
      )}

      {/* Basic values */}
      {orderedBasic.length > 0 && (
        <section aria-labelledby="section-basic" className="mb-8">
          <h2 ref={basicHeader} id="section-basic" className="mb-3 text-lg font-semibold">
            Basic values
          </h2>
          <div className="space-y-3">
            {orderedBasic.map((m) => {
              const key = mkKey(m);
              const src =
                m.sources.find((s) => s.fieldId === activeSourceByKey[key]) ??
                [...m.sources].sort((a, b) => b.confidence - a.confidence)[0];
              const isActive = activeKey === key;
              return (
                <div key={key} ref={isActive ? activeCardRef : undefined}>
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

      {/* Calculation values */}
      {orderedCalc.length > 0 && (
        <section aria-labelledby="section-calc" className="mb-8">
          <h2 ref={calcHeader} id="section-calc" className="mb-3 text-lg font-semibold">
            Values used for calculation
          </h2>
          <div className="space-y-3">
            {orderedCalc.map((m) => {
              const key = mkKey(m);
              const src =
                m.sources.find((s) => s.fieldId === activeSourceByKey[key]) ??
                [...m.sources].sort((a, b) => b.confidence - a.confidence)[0];
              const isActive = activeKey === key;
              return (
                <div key={key} ref={isActive ? activeCardRef : undefined}>
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

      {/* Safety check — read-only */}
      {untrusted.length > 0 && (
        <section aria-labelledby="section-safety" className="mb-8">
          <h2 id="section-safety" className="mb-3 text-lg font-semibold">
            Safety check
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Suspicious text was found in your documents. It is shown for
            transparency only — RentSmooth ignores it entirely. You cannot edit
            or confirm these items.
          </p>
          <div className="space-y-3">
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
            : `Confirm all values to continue (${totalCards - confirmedCount} left)`}
        </button>
      </div>
    </PageShell>
  );
}

function mkKey(m: MergedField) {
  return `${m.category}::${m.key}`;
}

