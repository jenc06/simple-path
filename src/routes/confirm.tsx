import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { PageShell, LiveRegion } from "@/components/page-shell";
import { EditableValue } from "@/components/editable-value";
import {
  allFields,
  mergedFields,
  useSession,
  type MergedField,
} from "@/lib/session-store";

export const Route = createFileRoute("/confirm")({
  head: () => ({
    meta: [{ title: "Final confirmation — RentSmooth" }],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { session } = useSession();
  const merged = useMemo(() => mergedFields(session), [session]);
  const fields = useMemo(() => allFields(session), [session]);
  const [announcement, setAnnouncement] = useState("");
  const navigate = useNavigate();

  const basic = merged.filter((m) => m.category === "basic");
  const calc = merged.filter((m) => m.category === "calculation");
  const anyOld = merged.some((m) => m.isOld);

  return (
    <PageShell title="Confirm your information" step="Final review">
      <LiveRegion message={announcement} />

      <p className="text-sm text-muted-foreground">
        Everything below is what RentSmooth will use. Tap any value to change
        it — nothing is used until you confirm here.
      </p>

      {anyOld && (
        <div
          role="note"
          className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Some values come from documents older than 6 months.</span>{" "}
            Check that they are still accurate.
          </p>
        </div>
      )}

      <Section title="Basic information">
        {basic.map((m) => (
          <Row key={`b-${m.key}`} merged={m} fields={fields} onEdited={setAnnouncement} />
        ))}
        {basic.length === 0 && <EmptyRow />}
      </Section>

      <Section title="Values used for calculation">
        {calc.map((m) => (
          <Row key={`c-${m.key}`} merged={m} fields={fields} onEdited={setAnnouncement} />
        ))}
        {calc.length === 0 && <EmptyRow />}
      </Section>

      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setAnnouncement("All information confirmed. Continuing to calculation.");
            navigate({ to: "/calculation" });
          }}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Yes, this information is correct
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: "/review" })}
          className="inline-flex h-11 w-full items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Go back and change something
        </button>
      </div>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <dl className="divide-y divide-border rounded-xl border bg-card">{children}</dl>
    </section>
  );
}

function EmptyRow() {
  return (
    <div className="px-4 py-3 text-sm text-muted-foreground">No values in this section.</div>
  );
}

function Row({
  merged,
  fields,
  onEdited,
}: {
  merged: MergedField;
  fields: ReturnType<typeof allFields>;
  onEdited: (msg: string) => void;
}) {
  // Bind edits to the first underlying field so EditableValue keeps working.
  const primary = fields.find((f) => f.key === merged.key && f.category === merged.category);
  const last = merged.history[merged.history.length - 1];
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 px-4 py-3">
      <dt className="text-sm font-medium text-muted-foreground">{merged.label}</dt>
      <dd className="min-w-0">
        {primary ? (
          <EditableValue
            field={{ ...primary, corrected: merged.corrected, value: merged.displayValue }}
            size="sm"
            onSaved={(v) =>
              onEdited(`${merged.label} updated to ${v}. Calculations will use this value.`)
            }
          />
        ) : (
          <span className="text-sm font-semibold">{merged.displayValue}</span>
        )}
        {last && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="line-through">{last.from}</span> → {last.to}
          </p>
        )}
        {merged.isOld && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-800">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Source older than 6 months
          </p>
        )}
      </dd>
      <dd className="justify-self-end">
        {merged.confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            <Check className="h-3 w-3" aria-hidden="true" />
            Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Not confirmed
          </span>
        )}
      </dd>
    </div>
  );
}
