import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, FileText, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import {
  DATE_CUTOFF,
  DOC_LABELS,
  TODAY,
  useSession,
  type DocType,
} from "@/lib/session-store";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload documents — RentSmooth" },
      {
        name: "description",
        content: "Add your income documents. You review everything before it's used.",
      },
    ],
  }),
  component: UploadPage,
});

const STEPS: DocType[] = [
  "application_form",
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
];

function UploadPage() {
  const { session, setSession } = useSession();
  const [stepIdx, setStepIdx] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [oldDatePending, setOldDatePending] = useState<null | {
    docType: DocType;
    fileName: string;
    date: string;
  }>(null);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentType = STEPS[stepIdx];
  const alreadyDone = useMemo(
    () => new Set(session.docs.map((d) => d.type)),
    [session.docs],
  );

  function addDoc(
    type: DocType,
    fileName: string,
    documentDate: string,
    status: "uploaded" | "expired",
  ) {
    setSession((s) => ({
      ...s,
      docs: [
        ...s.docs.filter((d) => d.type !== type),
        {
          id: `${type}-${Date.now()}`,
          type,
          fileName,
          documentDate,
          status,
          fields: [],
        },
      ],
    }));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires change.
    e.target.value = "";
    if (!file) return;

    const MAX_BYTES = 20 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setAnnouncement(
        `That file is larger than 20 MB. Please choose a smaller file.`,
      );
      return;
    }

    const fileName = file.name;
    const date = new Date(file.lastModified).toISOString().slice(0, 10);

    if (date < DATE_CUTOFF) {
      setOldDatePending({ docType: currentType, fileName, date });
      setAnnouncement(
        `This ${DOC_LABELS[currentType]} is dated ${date}, which is more than 60 days before ${TODAY}. Confirmation required.`,
      );
      return;
    }
    addDoc(currentType, fileName, date, "uploaded");
    setAnnouncement(
      `${DOC_LABELS[currentType]} uploaded: ${fileName}. Moved to next document.`,
    );
    next();
  }

  function skip() {
    setSession((s) => ({
      ...s,
      docs: [
        ...s.docs.filter((d) => d.type !== currentType),
        {
          id: `${currentType}-skip`,
          type: currentType,
          fileName: "—",
          status: "skipped",
          fields: [],
        },
      ],
    }));
    setAnnouncement(`Marked ${DOC_LABELS[currentType]} as not available. Moved on.`);
    next();
  }

  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  }

  function prev() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  function deleteDoc(id: string) {
    const doc = session.docs.find((d) => d.id === id);
    setSession((s) => ({
      ...s,
      docs: s.docs.filter((d) => d.id !== id),
    }));
    if (doc) {
      setAnnouncement(
        `${DOC_LABELS[doc.type]} removed. You can upload it again or continue.`,
      );
    }
  }

  const uploadedCount = session.docs.filter((d) => d.status !== "skipped").length;
  const canFinish = session.docs.length > 0;

  return (
    <PageShell title="Add your documents" step={`Step ${stepIdx + 1} of ${STEPS.length}`}>
      <LiveRegion message={announcement} />

      <p className="text-sm text-muted-foreground">
        Add your documents. We'll help you review what we find before anything is used.
      </p>

      {/* Progress */}
      <div className="mt-4">
        <div
          className="flex gap-1"
          role="progressbar"
          aria-valuenow={stepIdx + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label={`Upload progress: step ${stepIdx + 1} of ${STEPS.length}`}
        >
          {STEPS.map((t, i) => (
            <div
              key={t}
              className={
                "h-1.5 flex-1 rounded-full " +
                (i <= stepIdx ? "bg-primary" : "bg-muted")
              }
            />
          ))}
        </div>
      </div>

      <section
        aria-labelledby="current-doc"
        className="mt-6 rounded-2xl border bg-card p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 id="current-doc" className="text-lg font-semibold">
              {DOC_LABELS[currentType]}
            </h2>
            {alreadyDone.has(currentType) && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Already added — you can replace it.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={handleFileChosen}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={openFilePicker}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`Upload a file for ${DOC_LABELS[currentType]}`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload a file
          </button>
          <button
            type="button"
            onClick={skip}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`I do not have a ${DOC_LABELS[currentType]}`}
          >
            I do not have this
          </button>
        </div>
      </section>

      {/* Doc list summary */}
      {session.docs.length > 0 && (
        <section aria-labelledby="added" className="mt-6">
          <h3 id="added" className="text-sm font-semibold">
            Added so far
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {session.docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{DOC_LABELS[d.type]}</span>
                  <span className="ml-2 text-muted-foreground">{d.fileName}</span>
                </span>
                <div className="ml-3 flex items-center gap-2">
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium " +
                      (d.status === "uploaded"
                        ? "border border-emerald-600/30 bg-emerald-50 text-emerald-800"
                        : d.status === "expired"
                          ? "border border-amber-600/40 bg-amber-50 text-amber-900"
                          : "border border-input bg-muted text-muted-foreground")
                    }
                  >
                    {d.status === "uploaded" && (
                      <>
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Uploaded
                      </>
                    )}
                    {d.status === "expired" && (
                      <>
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Old — allowed
                      </>
                    )}
                    {d.status === "skipped" && "Not provided"}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteDoc(d.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`Remove ${DOC_LABELS[d.type]}`}
                    title={`Remove ${DOC_LABELS[d.type]}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          disabled={!canFinish}
          onClick={() => {
            setAnnouncement(
              `Done uploading. ${uploadedCount} document${uploadedCount === 1 ? "" : "s"} added. Going to review.`,
            );
            navigate({ to: "/review" });
          }}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="I'm done uploading. Go to review."
        >
          I'm done uploading!
        </button>
        <p className="text-xs text-muted-foreground">
          Cutoff for document age: <strong>{DATE_CUTOFF}</strong> (60 days before {TODAY}). If a
          file is older, we'll ask before using it.
        </p>
      </div>

      {oldDatePending && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="old-title"
          aria-describedby="old-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              <h2 id="old-title" className="text-lg font-semibold text-foreground">
                This document may be too old
              </h2>
            </div>
            <p id="old-body" className="mt-2 text-sm text-muted-foreground">
              <strong className="text-foreground">{oldDatePending.fileName}</strong> is dated{" "}
              <strong className="text-foreground">{oldDatePending.date}</strong>. Our cutoff is{" "}
              {DATE_CUTOFF} (60 days before {TODAY}). Do you want to include it anyway?
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setOldDatePending(null);
                  setAnnouncement("Old document not added. Choose another file.");
                }}
                className="inline-flex h-11 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                No, don't use it
              </button>
              <button
                type="button"
                onClick={() => {
                  addDoc(
                    oldDatePending.docType,
                    oldDatePending.fileName,
                    oldDatePending.date,
                    "expired",
                  );
                  setAnnouncement(
                    `Old document accepted with your permission. Moved to next step.`,
                  );
                  setOldDatePending(null);
                  next();
                }}
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Yes, use it anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
