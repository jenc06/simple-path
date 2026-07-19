import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
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
              Your annualized income
            </h2>
            <p className="mt-1 text-4xl font-bold tracking-tight">{currency(result.annual)}</p>

            <dl className="mt-5 space-y-3 text-sm">
              {result.contributions.map((c, i) => (
                <div key={i} className="rounded-md border bg-background p-3">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="mt-1 font-mono text-sm">{c.formula}</dd>
                  <dd className="mt-0.5 text-sm font-semibold">= {currency(c.amount)} / year</dd>
                </div>
              ))}
              <div className="border-t pt-3">
                <dt className="text-muted-foreground">Total annualized</dt>
                <dd className="text-lg font-bold">{currency(result.annual)}</dd>
              </div>
            </dl>

            {result.errors.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <p className="font-semibold">Some sources could not be included:</p>
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
              Comparison to threshold
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-2xl font-semibold">{currency(result.annual)}</span>
              <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-2xl font-semibold">{currency(threshold.amount)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              Rule effective date: {threshold.effective}
            </p>
            <p
              className="mt-3 inline-flex items-center rounded-full border border-slate-700/40 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-900"
            >
              Result: your income is {belowOrEqual ? "below or equal to" : "above"} the threshold.
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
              Rule source
            </h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="font-medium">{threshold.source}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Evidence mode</dt>
                <dd className="font-medium">
                  {referenceEvidence.fetchedWithTavily
                    ? "Tavily Extract from allowlisted HUD URLs"
                    : "Frozen local HUD reference"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Value used</dt>
                <dd className="font-medium">
                  {threshold.label} = {currency(threshold.amount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective date</dt>
                <dd className="font-medium">{threshold.effective}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Page</dt>
                <dd className="font-medium">{threshold.page}</dd>
              </div>
              <div>
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
              </div>
              {referenceEvidence.chunks.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Evidence snippet</dt>
                  <dd className="font-medium">{referenceEvidence.chunks[0].text}</dd>
                </div>
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
