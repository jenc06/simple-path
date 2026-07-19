import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { EditableValue } from "@/components/editable-value";

import {
  THRESHOLD,
  allFields,
  frequencyMultiplier,
  parseAmount,
  useSession,
} from "@/lib/session-store";

export const Route = createFileRoute("/calculation")({
  head: () => ({
    meta: [{ title: "Calculation — RentSmooth" }],
  }),
  component: CalculationPage,
});

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function CalculationPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState("");


  const result = useMemo(() => {
    const fields = allFields(session);
    const payField = fields.find((f) => f.label.toLowerCase().includes("pay before"));
    const raw = payField ? (payField.corrected ?? payField.value) : "";
    const amount = parseAmount(raw);
    const mult = frequencyMultiplier(session.frequency);

    const errors: string[] = [];
    if (!payField || Number.isNaN(amount)) errors.push("No confirmed income amount was found.");
    if (mult === null) errors.push("Pay frequency is unknown. Please go back and set it.");
    if (!Number.isNaN(amount) && amount < 0) errors.push("Income amount cannot be negative.");
    if (THRESHOLD.amount < 0) errors.push("Threshold cannot be negative.");

    const annual = mult && !Number.isNaN(amount) ? amount * mult : NaN;
    const belowOrEqual = !Number.isNaN(annual) && annual <= THRESHOLD.amount;

    return { amount, mult, annual, belowOrEqual, errors, raw };
  }, [session]);

  const freqLabel: Record<string, string> = {
    weekly: "every week",
    biweekly: "every 2 weeks",
    semimonthly: "twice a month",
    monthly: "monthly",
    unknown: "unknown",
  };

  return (
    <PageShell title="Calculation" step="Annualize and compare">
      {result.errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
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
            onClick={() => navigate({ to: "/review" })}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go back and fix this
          </button>
        </div>
      ) : (
        <>
          <section
            aria-labelledby="calc"
            className="rounded-2xl border bg-card p-5 shadow-sm"
          >
            <h2 id="calc" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Your annualized income
            </h2>
            <p className="mt-1 text-4xl font-bold tracking-tight">{currency(result.annual)}</p>

            <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Confirmed income</dt>
                <dd className="font-semibold">{currency(result.amount)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Frequency</dt>
                <dd className="font-semibold">{freqLabel[session.frequency]}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Formula</dt>
                <dd className="font-mono text-sm">
                  {currency(result.amount)} × {result.mult} = {currency(result.annual)}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="cmp"
            className="mt-4 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <h2 id="cmp" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Comparison to threshold
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-2xl font-semibold">{currency(result.annual)}</span>
              <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-2xl font-semibold">{currency(THRESHOLD.amount)}</span>
            </div>
            <p
              className={
                "mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold " +
                (result.belowOrEqual
                  ? "border border-emerald-700/40 bg-emerald-50 text-emerald-900"
                  : "border border-amber-700/40 bg-amber-50 text-amber-900")
              }
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Result: your income is{" "}
              {result.belowOrEqual ? "below or equal to" : "above"} the threshold.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              This is a factual comparison. It is not an approval, denial, or score.
            </p>
          </section>

          <section
            aria-labelledby="src"
            className="mt-4 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <h2 id="src" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Rule source
            </h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="font-medium">{THRESHOLD.source}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Value used</dt>
                <dd className="font-medium">
                  {THRESHOLD.label} = {currency(THRESHOLD.amount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective date</dt>
                <dd className="font-medium">{THRESHOLD.effective}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Page</dt>
                <dd className="font-medium">{THRESHOLD.page}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">URL</dt>
                <dd className="break-all">
                  <a
                    href={THRESHOLD.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {THRESHOLD.url}
                  </a>
                </dd>
              </div>
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
