import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, FileText, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { extractDocumentFields, scanDocument, type ScanResult } from "@/lib/extraction-backend";
import {
  DATE_CUTOFF,
  DOCUMENT_AGE_LIMIT_DAYS,
  DOC_LABELS,
  TODAY,
  useSession,
  type DocType,
  type ExtractedField,
} from "@/lib/session-store";
import type { EvidenceChunk } from "@/lib/evidence-types";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload documents — SimplePath" },
      {
        name: "description",
        content: "Add your income documents. You review everything before it's used.",
      },
    ],
  }),
  component: UploadPage,
});

type Phase = "application" | "income-choose" | "income-upload";

const INCOME_TYPES: DocType[] = [
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
];

const HELPER_TEXT: Partial<Record<DocType, string[]>> = {
  application_form: ["Name", "Household size", "Address"],
  pay_stub: ["Pay date", "Hours and rate", "Gross and net pay"],
  benefit_letter: ["Monthly benefit", "Benefit frequency"],
  employment_letter: ["Weekly hours", "Hourly rate"],
  gig_statement: ["Statement month", "Gross receipts", "Platform fees"],
};

function docLabel(type: DocType) {
  return DOC_LABELS[type];
}

function UploadPage() {
  const { session, setSession, recordAudit } = useSession();
  const [phase, setPhase] = useState<Phase>("application");
  const [selectedIncome, setSelectedIncome] = useState<DocType | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [oldDatePending, setOldDatePending] = useState<null | {
    docId: string;
    docType: DocType;
    fileName: string;
    date: string;
    fields: ExtractedField[];
    previewPages?: Record<number, string>;
    evidenceChunks?: EvidenceChunk[];
    warning?: string;
  }>(null);
  const [mismatchPending, setMismatchPending] = useState<null | {
    docId: string;
    file: File;
    fileName: string;
    selectedDocType: DocType;
    detectedDocType: DocType;
    scan: ScanResult;
  }>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentType: DocType =
    phase === "application" ? "application_form" : (selectedIncome ?? "pay_stub");

  const addedIncomeTypes = useMemo(
    () =>
      new Set(
        session.docs
          .filter((d) => INCOME_TYPES.includes(d.type) && d.status !== "skipped")
          .map((d) => d.type),
      ),
    [session.docs],
  );

  const hasApplication = session.docs.some(
    (d) => d.type === "application_form" && d.status !== "skipped",
  );
  const hasAnyIncome = addedIncomeTypes.size > 0;

  function addDoc(
    id: string,
    type: DocType,
    fileName: string,
    documentDate: string,
    status: "uploaded" | "expired",
    fields: ExtractedField[],
    previewPages?: Record<number, string>,
    evidenceChunks?: EvidenceChunk[],
  ) {
    setSession((s) => ({
      ...s,
      docs: [
        ...s.docs.filter((d) => !(d.type === type && d.status === "skipped")),
        {
          id,
          type,
          fileName,
          documentDate,
          status,
          previewPages,
          evidenceChunks,
          fields,
        },
      ],
    }));
    recordAudit("document_upload", {
      route: "/upload",
      docType: type,
      status,
    });
  }

  function advanceAfterAdd() {
    if (phase === "application") {
      setPhase("income-choose");
    } else {
      // After adding an income doc, go back to the chooser so user can add another or finish.
      setSelectedIncome(null);
      setPhase("income-choose");
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function extractAndMaybeAdd({
    docId,
    file,
    fileName,
    finalDocType,
    scan,
    mismatchWarning,
  }: {
    docId: string;
    file: File;
    fileName: string;
    finalDocType: DocType;
    scan: ScanResult;
    mismatchWarning?: string;
  }): Promise<{ status: "added" | "old_pending"; warnings: string[] }> {
    const extraction = await extractDocumentFields({
      finalDocType,
      docId,
      file,
      scan,
    });
    recordAudit("document_extract", {
      route: "/upload",
      docType: finalDocType,
      status: extraction.fields.length > 0 ? "fields_extracted" : "no_fields",
    });
    const fields = extraction.fields;
    const previewPages = extraction.previewPages ?? {};
    const evidenceChunks = extraction.evidenceChunks ?? [];
    const date =
      extraction.documentDate ??
      scan.documentDate ??
      new Date(file.lastModified).toISOString().slice(0, 10);

    if (date < DATE_CUTOFF) {
      setOldDatePending({
        docId,
        docType: finalDocType,
        fileName,
        date,
        fields,
        previewPages,
        evidenceChunks,
        warning: mismatchWarning,
      });
      recordAudit("document_upload", {
        route: "/upload",
        docType: finalDocType,
        status: "old_pending",
      });
      return { status: "old_pending", warnings: extraction.warnings };
    }

    setSession((s) => ({
      ...s,
      docs: [
        ...s.docs.filter((d) => !(d.type === finalDocType && d.status === "skipped")),
        {
          id: docId,
          type: finalDocType,
          fileName,
          documentDate: date,
          status: "uploaded",
          previewPages,
          evidenceChunks,
          fields,
        },
      ],
    }));

    if (mismatchWarning) {
      setAnnouncement(mismatchWarning);
    }
    recordAudit("document_upload", {
      route: "/upload",
      docType: finalDocType,
      status: "uploaded",
    });
    return { status: "added", warnings: extraction.warnings };
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const MAX_BYTES = 20 * 1024 * 1024;
    let addedCount = 0;
    let pendingOld = false;
    let tooLarge = 0;
    const warnings = new Set<string>();
    let pendingMismatch = false;

    setIsExtracting(true);
    setAnnouncement("Reading document. We will ask you to review what we find.");

    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          tooLarge += 1;
          continue;
        }
        const fileName = file.name;
        const id = `${currentType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const scan = await scanDocument(file, currentType);
        recordAudit("document_scan", {
          route: "/upload",
          docType: currentType,
          status: scan.detectedDocType === currentType ? "matched" : "mismatch",
        });
        scan.warnings.forEach((warning) => warnings.add(warning));

        if (scan.detectedDocType !== currentType) {
          setMismatchPending({
            docId: id,
            file,
            fileName,
            selectedDocType: currentType,
            detectedDocType: scan.detectedDocType,
            scan,
          });
          pendingMismatch = true;
          break;
        }

        const result = await extractAndMaybeAdd({
          docId: id,
          file,
          fileName,
          finalDocType: currentType,
          scan,
        });
        result.warnings.forEach((warning) => warnings.add(warning));
        if (result.status === "added") addedCount += 1;
        if (result.status === "old_pending") {
          pendingOld = true;
          break;
        }
      }
    } finally {
      setIsExtracting(false);
    }

    const sizeMsg =
      tooLarge > 0
        ? ` ${tooLarge} file${tooLarge === 1 ? " was" : "s were"} larger than 20 MB and skipped.`
        : "";
    const warningMsg = warnings.size > 0 ? ` ${Array.from(warnings).join(" ")}` : "";

    if (pendingOld) {
      setAnnouncement(
        `${addedCount} file${addedCount === 1 ? "" : "s"} added. One older file needs your confirmation.${sizeMsg}${warningMsg}`,
      );
      return;
    }

    if (pendingMismatch) {
      setAnnouncement(
        `${addedCount} file${addedCount === 1 ? "" : "s"} added. One file needs your document type choice.${sizeMsg}${warningMsg}`,
      );
      return;
    }

    if (addedCount > 0) {
      setAnnouncement(
        `${addedCount} file${addedCount === 1 ? "" : "s"} added.${sizeMsg}${warningMsg}`,
      );
      advanceAfterAdd();
    } else if (tooLarge > 0) {
      setAnnouncement(`No files added.${sizeMsg}`);
    }
  }

  async function resolveMismatch(finalDocType: DocType, warning?: string) {
    if (!mismatchPending) return;
    const pending = mismatchPending;
    setMismatchPending(null);
    setIsExtracting(true);
    setAnnouncement("Reading document. We will ask you to review what we find.");
    try {
      const result = await extractAndMaybeAdd({
        docId: pending.docId,
        file: pending.file,
        fileName: pending.fileName,
        finalDocType,
        scan: pending.scan,
        mismatchWarning: warning,
      });
      const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
      if (result.status === "added") {
        setAnnouncement(
          warning ?? `${pending.fileName} added as ${docLabel(finalDocType)}.${warningText}`,
        );
        advanceAfterAdd();
      } else {
        setAnnouncement(
          `${pending.fileName} needs your confirmation because it may be too old.${warningText}`,
        );
      }
    } finally {
      setIsExtracting(false);
    }
  }

  function skipApplication() {
    setSession((s) => ({
      ...s,
      docs: [
        ...s.docs.filter((d) => d.type !== "application_form"),
        {
          id: "application_form-skip",
          type: "application_form",
          fileName: "—",
          status: "skipped",
          fields: [],
        },
      ],
    }));
    recordAudit("document_upload", {
      route: "/upload",
      docType: "application_form",
      status: "skipped",
    });
    setAnnouncement("Marked application form as not available. Moving to income.");
    setPhase("income-choose");
  }

  function deleteDoc(id: string) {
    const doc = session.docs.find((d) => d.id === id);
    setSession((s) => ({
      ...s,
      docs: s.docs.filter((d) => d.id !== id),
    }));
    if (doc) {
      recordAudit("document_delete", {
        route: "/upload",
        docType: doc.type,
        status: "deleted",
      });
      setAnnouncement(`${DOC_LABELS[doc.type]} removed. You can upload it again or continue.`);
    }
  }

  const canFinish = hasAnyIncome && hasApplication;
  const uploadedCount = session.docs.filter((d) => d.status !== "skipped").length;
  const missingReasons: string[] = [];
  if (!hasApplication) missingReasons.push("an application form");
  if (!hasAnyIncome) missingReasons.push("at least one income document");
  const notAllowedReason =
    missingReasons.length > 0
      ? `Not allowed yet — add ${missingReasons.join(" and ")} before continuing.`
      : "";

  const stepLabel = phase === "application" ? "Step 1 of 2" : "Step 2 of 2";

  return (
    <PageShell title="Build your renter packet" step={stepLabel}>
      <LiveRegion message={announcement} />

      <p className="text-sm text-muted-foreground">
        Add the documents that describe you and your income. You'll review every value on the next
        step — nothing is used until you confirm it.
      </p>

      {/* Progress */}
      <div className="mt-4">
        <div
          className="flex gap-1"
          role="progressbar"
          aria-valuenow={phase === "application" ? 1 : 2}
          aria-valuemin={1}
          aria-valuemax={2}
          aria-label={`Progress: ${stepLabel}`}
        >
          <div className="h-1.5 flex-1 rounded-full bg-primary" />
          <div
            className={
              "h-1.5 flex-1 rounded-full " + (phase !== "application" ? "bg-primary" : "bg-muted")
            }
          />
        </div>
      </div>

      {/* STEP 1: Application form */}
      {phase === "application" && (
        <section
          aria-labelledby="app-heading"
          className="mt-6 rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 id="app-heading" className="text-lg font-semibold">
                Add application form
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">This helps fill in:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {HELPER_TEXT.application_form!.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              {hasApplication && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Already added — you can add more or replace it.
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="sr-only"
              onChange={handleFileChosen}
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isExtracting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-describedby={isExtracting ? "application-upload-not-allowed" : undefined}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {isExtracting ? "Not allowed - reading document" : "Upload application form"}
            </button>
            {isExtracting && (
              <p id="application-upload-not-allowed" className="text-xs font-medium text-amber-800">
                Not allowed yet: wait for the current document to finish reading.
              </p>
            )}
            {hasApplication ? (
              <button
                type="button"
                onClick={() => setPhase("income-choose")}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={skipApplication}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                I do not have this
              </button>
            )}
          </div>
        </section>
      )}

      {/* STEP 2a: Choose income doc type */}
      {phase === "income-choose" && (
        <section
          aria-labelledby="income-heading"
          className="mt-6 rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 id="income-heading" className="text-lg font-semibold">
                {hasAnyIncome ? "Add another income document?" : "Add income document"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasAnyIncome
                  ? "Optional. Add another only if you have more than one source of income."
                  : "Required. Choose one you have:"}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {INCOME_TYPES.map((t) => {
              const already = addedIncomeTypes.has(t);
              const label = hasAnyIncome ? `Add another ${DOC_LABELS[t]}` : `Add ${DOC_LABELS[t]}`;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setSelectedIncome(t);
                    setPhase("income-upload");
                  }}
                  className="inline-flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={label}
                >
                  <span>{label}</span>
                  {already && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Added
                    </span>
                  )}
                </button>
              );
            })}
            {hasAnyIncome && (
              <button
                type="button"
                onClick={() => {
                  setAnnouncement(
                    `Done uploading. ${uploadedCount} document${uploadedCount === 1 ? "" : "s"} added. Going to review.`,
                  );
                  navigate({ to: "/review" });
                }}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                No more income sources — continue to review
              </button>
            )}
            <button
              type="button"
              onClick={() => setPhase("application")}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Back to application form
            </button>
          </div>
        </section>
      )}

      {/* STEP 2b: Upload chosen income doc */}
      {phase === "income-upload" && selectedIncome && (
        <section
          aria-labelledby="income-upload-heading"
          className="mt-6 rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 id="income-upload-heading" className="text-lg font-semibold">
                Add {DOC_LABELS[selectedIncome]}
              </h2>
              {HELPER_TEXT[selectedIncome] && (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">This helps fill in:</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                    {HELPER_TEXT[selectedIncome]!.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                You can select more than one file at a time.
              </p>
              {addedIncomeTypes.has(selectedIncome) && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Already added — you can add more or replace it.
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="sr-only"
              onChange={handleFileChosen}
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isExtracting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-describedby={isExtracting ? "income-upload-not-allowed" : undefined}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {isExtracting
                ? "Not allowed - reading document"
                : `Upload ${DOC_LABELS[selectedIncome]}`}
            </button>
            {isExtracting && (
              <p id="income-upload-not-allowed" className="text-xs font-medium text-amber-800">
                Not allowed yet: wait for the current document to finish reading.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedIncome(null);
                setPhase("income-choose");
              }}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Choose a different document type
            </button>
          </div>
        </section>
      )}

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
                  {d.status !== "skipped" && (
                    <button
                      type="button"
                      onClick={() => deleteDoc(d.id)}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input px-2 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={`Delete ${DOC_LABELS[d.type]}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-2">
        {canFinish ? (
          <button
            type="button"
            onClick={() => {
              setAnnouncement(
                `Done uploading. ${uploadedCount} document${uploadedCount === 1 ? "" : "s"} added. Going to review.`,
              );
              navigate({ to: "/review" });
            }}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Continue to review your extracted values."
          >
            Continue to review
          </button>
        ) : (
          <div
            role="status"
            className="rounded-xl border border-amber-500/60 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p className="font-semibold">Not allowed to continue yet</p>
            <p className="mt-1">{notAllowedReason}</p>
            <ul className="mt-2 list-disc pl-5 text-xs">
              {!hasApplication && <li>Application form is required.</li>}
              {!hasAnyIncome && <li>At least one income document is required.</li>}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Cutoff for document age: <strong>{DATE_CUTOFF}</strong> ({DOCUMENT_AGE_LIMIT_DAYS} days
          before {TODAY}). If a file is older, we'll ask before using it.
        </p>
      </div>


      {mismatchPending && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="mismatch-title"
          aria-describedby="mismatch-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              <h2 id="mismatch-title" className="text-lg font-semibold text-foreground">
                This looks like {docLabel(mismatchPending.detectedDocType)}
              </h2>
            </div>
            <p id="mismatch-body" className="mt-2 text-sm text-muted-foreground">
              You uploaded <strong className="text-foreground">{mismatchPending.fileName}</strong>{" "}
              under{" "}
              <strong className="text-foreground">
                {docLabel(mismatchPending.selectedDocType)}
              </strong>
              . What do you want to do?
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isExtracting}
                onClick={() =>
                  resolveMismatch(
                    mismatchPending.selectedDocType,
                    `${mismatchPending.fileName} uploaded as ${docLabel(
                      mismatchPending.selectedDocType,
                    )}. This may not match the selected document type. Please review carefully.`,
                  )
                }
                className="inline-flex h-11 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExtracting ? "Not allowed - reading document" : "No, upload anyway"}
              </button>
              <button
                type="button"
                disabled={isExtracting}
                onClick={() => resolveMismatch(mismatchPending.detectedDocType)}
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExtracting ? "Not allowed - reading document" : "Yes, move it"}
              </button>
            </div>
            {isExtracting && (
              <p className="mt-2 text-xs font-medium text-amber-800">
                Not allowed yet: wait for the current document to finish reading.
              </p>
            )}
          </div>
        </div>
      )}

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
              {DATE_CUTOFF} ({DOCUMENT_AGE_LIMIT_DAYS} days before {TODAY}). Do you want to include
              it anyway?
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
                    oldDatePending.docId,
                    oldDatePending.docType,
                    oldDatePending.fileName,
                    oldDatePending.date,
                    "expired",
                    oldDatePending.fields,
                    oldDatePending.previewPages,
                    oldDatePending.evidenceChunks,
                  );
                  setAnnouncement(
                    oldDatePending.warning ?? `Old document accepted with your permission.`,
                  );
                  setOldDatePending(null);
                  advanceAfterAdd();
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
