import { AlertTriangle, Check, CircleDot } from "lucide-react";
import {
  DOC_LABELS,
  buildIncomeSourceTimeline,
  type IncomeSourceReview,
  type IncomeSourceTimelineEvent,
  type SessionState,
} from "@/lib/session-store";

export function IncomeSourceTimeline({
  session,
  review,
  compact = false,
}: {
  session: SessionState;
  review: IncomeSourceReview;
  compact?: boolean;
}) {
  const events = buildIncomeSourceTimeline(session, review);
  if (events.length === 0) return null;
  const isCountedOnce = review.choice === "same_source_count_once";
  const title = isCountedOnce ? "Why counted once" : "Why this needs review";
  const summary = isCountedOnce
    ? "These documents describe the same income source, so it is counted one time in the total."
    : "These documents describe the same income source. Choose whether to count them once or as separate sources.";

  return (
    <div className={compact ? "mt-3" : "mt-4 rounded-md border bg-background p-3"}>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Show sources ({events.length})
        </summary>
        <ol className="mt-3 space-y-3">
          {events.map((event) => (
            <li key={event.id} className="grid grid-cols-[1.25rem_1fr] gap-2 text-sm">
              <TimelineIcon event={event} />
              <div>
                <p className="font-medium">{event.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {event.detail}
                </p>
                {event.documentIds.length > 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {event.documentIds
                      .map((id) => {
                        const doc = session.docs.find((item) => item.id === id);
                        return doc ? `${doc.fileName} (${DOC_LABELS[doc.type]})` : null;
                      })
                      .filter(Boolean)
                      .join("; ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function TimelineIcon({ event }: { event: IncomeSourceTimelineEvent }) {
  if (event.status === "warning" || event.status === "blocked") {
    return <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" aria-hidden="true" />;
  }
  if (event.status === "matched" || event.status === "counted") {
    return <Check className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" />;
  }
  return <CircleDot className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}
