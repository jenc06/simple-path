import { createFileRoute, Link } from "@tanstack/react-router";
import { Info, ShieldCheck } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-10 text-center"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Private. Session only. Never used to train AI.</span>
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
          RentSmooth
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          A calm, step-by-step review of the income documents you upload. You confirm every
          value — this tool never approves, denies, or scores anything.
        </p>

        <Link
          to="/upload"
          className="mt-8 inline-flex h-14 w-full items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Start income review"
        >
          Start
        </Link>

        <ul className="mt-8 w-full space-y-2 text-left text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span aria-hidden="true">1.</span>
            <span>Upload your documents.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">2.</span>
            <span>Review each value we find, one at a time.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">3.</span>
            <span>See the calculation and download your packet.</span>
          </li>
        </ul>
      </main>

      <div className="pb-8">
        <div className="mx-auto flex max-w-lg justify-center px-6">
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Learn how this works and what data we use"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            <span>How this works</span>
          </button>
        </div>
      </div>

      {infoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl">
            <h2 id="info-title" className="text-lg font-semibold">
              How this works
            </h2>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">We do not decide anything.</strong> We
                extract values from your documents so you can confirm them. Approval or
                denial is based only on the published rule and the numbers you confirm.
              </p>
              <p>
                <strong className="text-foreground">We do not infer protected traits.</strong>{" "}
                No demographic, behavioral, or landlord-revenue features are used.
              </p>
              <p>
                <strong className="text-foreground">Your data stays yours.</strong> Processing
                is ephemeral, local persisted data is stored only for this browser session,
                documents are never used to train AI, and you can delete this session at any time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Got it, close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
