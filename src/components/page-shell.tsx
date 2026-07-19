import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, MessageCircle, RotateCcw, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSession } from "@/lib/session-store";

interface PageShellProps {
  title: string;
  step?: string;
  children: ReactNode;
  hideBack?: boolean;
}

export function PageShell({ title, step, children, hideBack }: PageShellProps) {
  const router = useRouter();
  const { resetSession, deleteSession } = useSession();
  const [chatOpen, setChatOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "restart">(null);

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 py-3">
          {!hideBack && (
            <button
              type="button"
              onClick={() => router.history.back()}
              className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Go back to previous page"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back</span>
            </button>
          )}
          <div className="flex-1 min-w-0">
            {step && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {step}
              </p>
            )}
            <h1 className="truncate text-base font-semibold">{title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setConfirm("restart")}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Restart session"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Restart</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirm("delete")}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
            aria-label="Delete session and all data"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {children}
      </main>

      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Open help chat"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        <span>Help</span>
      </button>

      {chatOpen && <ChatPopup onClose={() => setChatOpen(false)} />}

      {confirm && (
        <ConfirmDialog
          title={confirm === "delete" ? "Delete this session?" : "Restart this session?"}
          body={
            confirm === "delete"
              ? "All uploaded documents and extracted values will be permanently deleted. This cannot be undone."
              : "You'll start over from the beginning. Sample data will be restored."
          }
          confirmLabel={confirm === "delete" ? "Yes, delete everything" : "Yes, restart"}
          destructive={confirm === "delete"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "delete") deleteSession();
            else resetSession();
            setConfirm(null);
            router.navigate({ to: "/" });
          }}
        />
      )}
    </div>
  );
}

function ChatPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="chat-title" className="text-base font-semibold">
            Help chat
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Close help chat"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          <p className="rounded-lg bg-muted p-3">
            Hi. I can explain what a step means, but I never decide anything for you.
            Approvals are based only on the rule, your confirmed inputs, and the calculation.
          </p>
          <p className="rounded-lg bg-muted p-3">
            Try asking: "What does 'annualized income' mean?" or "Why do you need this document?"
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="flex gap-2 border-t p-3"
        >
          <label htmlFor="chat-input" className="sr-only">
            Type your question
          </label>
          <input
            id="chat-input"
            type="text"
            placeholder="Type a question…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-sm text-muted-foreground">
          {body}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? "inline-flex h-11 items-center justify-center rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                : "inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
