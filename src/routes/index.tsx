import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Info, ShieldCheck } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

const STEPS = [
  {
    n: "01",
    title: "Upload your documents",
    body: "Add your application form and at least one income document — pay stubs, benefit letters, tax returns. You can attach several files per document.",
  },
  {
    n: "02",
    title: "Review each value",
    body: "Basic values (name, household) and calculation values (hours, pay) — one card at a time. The document highlights where every value was found so you can confirm or correct it.",
  },
  {
    n: "03",
    title: "See the calculation",
    body: "A plain, factual comparison of the annualized income to the referenced threshold. No approval, denial, or score is ever produced.",
  },
  {
    n: "04",
    title: "Download your packet",
    body: "Preview and download a printable PDF for your caseworker or landlord. When you are done, delete the session with one button.",
  },
];

function Home() {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <main id="main" className="mx-auto w-full max-w-6xl px-6 py-16 md:px-12 md:py-24">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-24 items-start">
          {/* Left rail — identity + context (sticky on desktop) */}
          <section
            aria-labelledby="brand-heading"
            className="flex flex-col space-y-12 lg:sticky lg:top-16"
          >
            <div className="space-y-4">
              <span className="inline-block border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                System / 01 · Income review
              </span>
              <h1
                id="brand-heading"
                className="font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl"
              >
                SimplePath
              </h1>
            </div>

            <div className="space-y-6 max-w-md">
              <p className="text-lg leading-relaxed text-[color:var(--muted-foreground)]">
                A private, non-decisioning walkthrough for reviewing the income documents you
                upload. You confirm every value. This tool never approves, denies, or scores
                anything.
              </p>
            </div>

            <div className="hidden lg:block">
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="inline-flex items-center gap-2 border-b border-border pb-1 text-sm font-medium text-foreground hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
                <span>How this works</span>
              </button>
            </div>
          </section>

          {/* Right column — timeline + CTA */}
          <section aria-labelledby="steps-heading" className="relative">
            <h2 id="steps-heading" className="sr-only">
              The four steps
            </h2>
            <ol className="border-l border-border pl-8 space-y-14 md:pl-12">
              {STEPS.map((step, i) => (
                <li key={step.n} className="relative">
                  <span
                    aria-hidden="true"
                    className={
                      "absolute -left-[41px] md:-left-[57px] top-0 w-6 bg-background py-1 text-center font-mono text-[11px] font-bold " +
                      (i === 0 ? "text-[color:var(--ring)]" : "text-muted-foreground")
                    }
                  >
                    {step.n}
                  </span>
                  <div className="space-y-2">
                    <h3 className="font-display text-xl font-medium tracking-tight">
                      <span className="sr-only">Step {step.n}. </span>
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-14 pl-8 md:pl-12">
              <Link
                to="/upload"
                className="group inline-flex items-center gap-8 bg-primary px-8 py-5 text-primary-foreground transition-colors hover:bg-[color:var(--foreground)]/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                aria-label="Start income review"
              >
                <span className="text-sm font-semibold uppercase tracking-[0.2em]">
                  Start verification
                </span>
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
              <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Avg. completion time · 4–6 minutes
              </p>
            </div>

            <div className="mt-16 pl-8 md:pl-12 lg:hidden">
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="inline-flex items-center gap-2 border-b border-border pb-1 text-sm font-medium text-foreground hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
                <span>How this works</span>
              </button>
            </div>
          </section>
        </div>

        <div className="mt-24 grid grid-cols-1 gap-6 border-t border-border pt-8 text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:grid-cols-3">
          <div>
            <div className="mb-1 font-mono text-[10px] text-muted-foreground/70">Privacy</div>
            <div className="font-medium text-foreground">
              <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Non-decisioning
            </div>
          </div>
          <div>
            <div className="mb-1 font-mono text-[10px] text-muted-foreground/70">Storage</div>
            <div className="font-medium text-foreground">Local session only</div>
          </div>
          <div>
            <div className="mb-1 font-mono text-[10px] text-muted-foreground/70">Accessibility</div>
            <div className="font-medium text-foreground">WCAG 2.2 AA</div>
          </div>
        </div>
      </main>

      {infoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        >
          <div className="w-full max-w-md bg-background p-6 shadow-xl sm:border sm:border-border">
            <h2 id="info-title" className="font-display text-xl font-semibold tracking-tight">
              How this works
            </h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">We do not decide anything.</strong> Values are
                extracted so you can confirm them. Approval or denial rests only on the published
                rule and the numbers you confirm.
              </p>
              <p>
                <strong className="text-foreground">We do not infer protected traits.</strong> No
                demographic, behavioral, or landlord-revenue features are used.
              </p>
              <p>
                <strong className="text-foreground">Your data stays yours.</strong> Processing is
                ephemeral, local persistence is scoped to this browser session, documents are never
                used to train AI, and you can delete this session at any time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="mt-6 inline-flex h-11 w-full items-center justify-center bg-primary px-4 text-sm font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:bg-[color:var(--foreground)]/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Got it, close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
