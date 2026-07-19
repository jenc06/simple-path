import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";


import {
  computeAnnualIncome,
  effectiveHouseholdSize,
  thresholdForHouseholdSize,
  useSession,
} from "@/lib/session-store";
import { fetchReferenceEvidence, frozenReferenceEvidence } from "@/lib/reference-evidence";

export const Route = createFileRoute("/calculation")({
  head: () => ({
    meta: [{ title: "Calculation — SimplePath" }],
  }),
  component: CalculationPage,
});

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pdfPageUrl(url: string, page: number) {
  return `${url}#page=${page}`;
}

function CalculationPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState("");
  const [referenceEvidence, setReferenceEvidence] = useState(() =>
    frozenReferenceEvidence(effectiveHouseholdSize(session)),
  );

  const result = useMemo(() => computeAnnualIncome(session), [session]);
  const householdSize = useMemo(() => effectiveHouseholdSize(session), [session]);
  const threshold = useMemo(
    () => thresholdForHouseholdSize(householdSize),
    [householdSize],
  );

  const belowOrEqual = result.annual <= threshold.amount;
  const hasIncomeSourceBlock = result.errors.some(
    (error) => error.includes("duplicate income") || error.includes("manual review"),
  );
  const hasBlockingError =
    hasIncomeSourceBlock || (result.errors.length > 0 && result.contributions.length === 0);

  useEffect(() => {
    let cancelled = false;
    fetchReferenceEvidence(householdSize).then((evidence) => {
      if (!cancelled) setReferenceEvidence(evidence);
    });
    return () => {
      cancelled = true;
    };
  }, [householdSize]);

  return (
    <PageShell title="Calculation" step="Annualize and compare">
      <LiveRegion message={announcement} />

      {hasBlockingError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-base font-semibold">We can't finish the calculation</h2>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-foreground">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setAnnouncement("Going back to review values.");
              navigate({ to: "/review" });
            }}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go back and fix this
          </button>
        </div>
      ) : (
        <>
          <section aria-labelledby="calc" className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2
              id="calc"
              className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
            >
              1. Your annualized income
            </h2>
            <p className="mt-1 text-4xl font-bold tracking-tight">{currency(result.annual)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Total annualized income across all confirmed sources.
            </p>

            <h3 className="mt-5 text-sm font-semibold text-foreground">Contributions</h3>
            <ol className="mt-2 space-y-3 text-sm">
              {result.contributions.map((c, i) => (
                <li
                  key={i}
                  className="rounded-md border bg-background p-3"
                  aria-label={`Contribution ${i + 1} of ${result.contributions.length}`}
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Contribution {i + 1}
                  </p>
                  <dl className="mt-2 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="font-medium">{c.label}</dd>

                    <dt className="text-muted-foreground">Formula</dt>
                    <dd className="font-mono text-[0.85rem]">{c.formula}</dd>

                    <dt className="text-muted-foreground">Annualized amount</dt>
                    <dd className="font-semibold">{currency(c.amount)} / year</dd>

                    <dt className="text-muted-foreground">Documents used</dt>
                    <dd className="text-xs text-muted-foreground">
                      {c.documentIds.length} document{c.documentIds.length === 1 ? "" : "s"}
                    </dd>
                  </dl>
                </li>
              ))}
              <li className="border-t pt-3">
                <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted-foreground">Total annualized</dt>
                  <dd className="text-lg font-bold">{currency(result.annual)}</dd>
                </dl>
              </li>
            </ol>

            {result.errors.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span>Warning — some sources could not be included:</span>
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {result.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="cmp" className="mt-4 rounded-2xl border bg-card p-5 shadow-sm">
            <h2
              id="cmp"
              className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
            >
              2. Comparison to threshold
            </h2>

            <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Confirmed value</dt>
              <dd className="font-semibold">{currency(result.annual)} (annualized income)</dd>

              <dt className="text-muted-foreground">Threshold</dt>
              <dd className="font-semibold">
                {currency(threshold.amount)} ({threshold.label})
              </dd>

              <dt className="text-muted-foreground">Formula</dt>
              <dd className="font-mono text-[0.85rem]">
                {currency(result.annual)} {belowOrEqual ? "≤" : "≥"} {currency(threshold.amount)}
              </dd>

              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-medium">{threshold.source}</dd>

              <dt className="text-muted-foreground">Effective date</dt>
              <dd className="font-medium">{threshold.effective}</dd>
            </dl>

            <div className="mt-3 flex items-center gap-3" aria-hidden="true">
              <span className="text-2xl font-semibold">{currency(result.annual)}</span>
              <span className="text-2xl font-semibold text-muted-foreground" aria-hidden="true">
                {belowOrEqual ? "≤" : "≥"}
              </span>
              <span className="text-2xl font-semibold">{currency(threshold.amount)}</span>
            </div>

            <p
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-700/40 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-900"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>
                Result: your income is {belowOrEqual ? "below or equal to" : "above"} the threshold.
              </span>
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              This is a factual comparison. It is not an approval, denial, or score.
            </p>
          </section>

          <section aria-labelledby="src" className="mt-4 rounded-2xl border bg-card p-5 shadow-sm">
            <h2
              id="src"
              className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
            >
              3. Rule source and evidence
            </h2>
            <dl className="mt-2 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-medium">{threshold.source}</dd>

              <dt className="text-muted-foreground">Evidence mode</dt>
              <dd className="font-medium">
                {referenceEvidence.fetchedWithTavily
                  ? "Tavily Extract from allowlisted HUD URLs"
                  : "Frozen local HUD reference"}
              </dd>

              <dt className="text-muted-foreground">Value used</dt>
              <dd className="font-medium">
                {threshold.label} = {currency(threshold.amount)}
              </dd>

              <dt className="text-muted-foreground">Effective date</dt>
              <dd className="font-medium">{threshold.effective}</dd>

              <dt className="text-muted-foreground">Page</dt>
              <dd className="font-medium">{threshold.page}</dd>

              <dt className="text-muted-foreground">URL</dt>
              <dd className="break-all">
                <a
                  href={pdfPageUrl(threshold.url, threshold.page)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {pdfPageUrl(threshold.url, threshold.page)}
                </a>
              </dd>

              {referenceEvidence.chunks.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Evidence snippet</dt>
                  <dd className="font-medium">{referenceEvidence.chunks[0].text}</dd>
                </>
              )}
            </dl>
          </section>


          <button
            type="button"
            onClick={() => navigate({ to: "/packet" })}
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Continue to your packet
          </button>
        </>
      )}
    </PageShell>
  );
}
