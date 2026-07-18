import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { DocPreview } from "@/components/doc-preview";
import { DOC_LABELS, allFields, useSession } from "@/lib/session-store";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review values — Income Check" },
      { name: "description", content: "Confirm each extracted value one at a time." },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { session, confirmField } = useSession();
  const fields = useMemo(() => allFields(session), [session]);
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const navigate = useNavigate();

  if (fields.length === 0) {
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

  const field = fields[Math.min(idx, fields.length - 1)];
  const done = fields.filter((f) => f.confirmed).length;

  function accept() {
    confirmField(field.id);
    setAnnouncement(`Confirmed ${field.label}. ${done + 1} of ${fields.length} done.`);
    goNext();
  }

  function saveEdit() {
    if (!draft.trim()) {
      setError("Enter the correct value. This field cannot be empty.");
      return;
    }
    setError("");
    confirmField(field.id, draft.trim());
    setAnnouncement(
      `${field.label} corrected to ${draft.trim()}. ${done + 1} of ${fields.length} done.`,
    );
    setEditing(false);
    setDraft("");
    goNext();
  }

  function goNext() {
    if (idx < fields.length - 1) setIdx(idx + 1);
    else {
      setAnnouncement("All values reviewed. Going to final confirmation.");
      navigate({ to: "/confirm" });
    }
  }

  return (
    <PageShell
      title="Review one at a time"
      step={`Value ${Math.min(idx + 1, fields.length)} of ${fields.length}`}
    >
      <LiveRegion message={announcement} />

      <div
        className="mb-4 flex gap-1"
        role="progressbar"
        aria-valuenow={idx + 1}
        aria-valuemin={1}
        aria-valuemax={fields.length}
        aria-label={`Review progress: value ${idx + 1} of ${fields.length}`}
      >
        {fields.map((_, i) => (
          <div
            key={i}
            className={"h-1.5 flex-1 rounded-full " + (i <= idx ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          We found this with {field.confidence}% confidence
        </p>
        <h2 className="mt-1 text-xl font-semibold">{field.label}</h2>
        <p className="mt-2 text-3xl font-bold tracking-tight">{field.value}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Source:</span>{" "}
          {DOC_LABELS[field.sourceDoc]}, page {field.sourcePage}
        </p>

        <div className="mt-4">
          <DocPreview field={field} />
          <p className="mt-2 text-xs text-muted-foreground">
            Yellow highlight shows where this value appears in your document.
          </p>
        </div>

        {!editing ? (
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={accept}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Yes, use ${field.value} for ${field.label}`}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Yes, use this
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setDraft(field.value);
              }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`This is wrong. Correct the value for ${field.label}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              This is wrong. Change it
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
            className="mt-5 space-y-3"
            noValidate
          >
            <label htmlFor="correct" className="block text-sm font-medium">
              Correct value for {field.label}
            </label>
            <input
              id="correct"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "correct-error" : undefined}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            {error && (
              <p id="correct-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Cancel edit
              </button>
              <button
                type="submit"
                className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Save correction
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {done} of {fields.length} values confirmed
      </p>
    </PageShell>
  );
}
