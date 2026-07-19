import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, MessageCircle, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  classifyChatRequest,
  createChatSnapshot,
  fallbackChatAnswer,
  PENDING_FIELD_FOCUS_KEY,
  type ChatAnswer,
  type ChatNavigation,
} from "@/lib/chat-guardrails";
import type { ChatNextAction } from "@/lib/chat-workflow";
import { fetchReferenceEvidence } from "@/lib/reference-evidence";
import { effectiveHouseholdSize, useSession } from "@/lib/session-store";

interface PageShellProps {
  title: string;
  step?: string;
  children: ReactNode;
  hideBack?: boolean;
  wide?: boolean;
}

export function PageShell({ title, step, children, hideBack, wide }: PageShellProps) {
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

      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 pt-2">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary/80">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-display text-[13px] tracking-tight text-primary">SimplePath</span>
          </div>
        </div>
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
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {step}
              </p>
            )}
            <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
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

      <main
        id="main"
        className={"mx-auto w-full flex-1 px-4 py-6 " + (wide ? "max-w-7xl" : "max-w-2xl")}
      >
        {children}
      </main>

      <footer className="border-t border-border/70 bg-parchment/60">
        <div className="mx-auto flex max-w-2xl flex-col gap-1 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            SimplePath never approves or denies applications — every value stays under your control.
          </p>
          <p>WCAG 2.2 AA · Local session storage · Ephemeral processing</p>
        </div>
      </footer>

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
  const router = useRouter();
  const { session, recordAudit } = useSession();
  const [messages, setMessages] = useState<
    Array<{
      role: "assistant" | "user";
      text: string;
      navigation?: ChatNavigation;
      blockers?: string[];
      nextActions?: ChatNextAction[];
      citations?: string[];
    }>
  >([
    {
      role: "assistant",
      text: "Hi. I can answer from your uploaded inputs and the rule source, explain security, and help you navigate. I cannot decide, infer missing values, use protected traits, or change anything.",
    },
    {
      role: "assistant",
      text: 'Try asking: "What should I do next?", "Why is calculation blocked?", or "Take me to gross pay on the Review page."',
    },
  ]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  async function submitQuestion() {
    const trimmed = draft.trim();
    if (!trimmed || pending) return;
    const classification = classifyChatRequest(trimmed);
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    recordAudit(classification.allowed ? "chat_help" : "chat_refusal", {
      route: window.location.pathname,
      status: classification.allowed ? "requested" : classification.reason,
    });
    setDraft("");
    setPending(true);
    try {
      const referenceEvidence = await fetchReferenceEvidence(effectiveHouseholdSize(session));
      const snapshot = createChatSnapshot(session, window.location.pathname, referenceEvidence);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, snapshot }),
      });
      const answer = response.ok
        ? ((await response.json()) as ChatAnswer)
        : fallbackChatAnswer(trimmed, snapshot);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answer.answer,
          navigation: answer.navigation,
          blockers: answer.blockers,
          nextActions: answer.nextActions,
          citations: answer.citations,
        },
      ]);
      recordAudit(answer.refused ? "chat_refusal" : "chat_help", {
        route: window.location.pathname,
        status: answer.refused ? String(answer.reason ?? "refused") : "answered",
      });
    } catch {
      const snapshot = createChatSnapshot(session, window.location.pathname);
      const answer = fallbackChatAnswer(trimmed, snapshot);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answer.answer,
          navigation: answer.navigation,
          blockers: answer.blockers,
          nextActions: answer.nextActions,
          citations: answer.citations,
        },
      ]);
      recordAudit("chat_help", { route: window.location.pathname, status: "fallback" });
    } finally {
      setPending(false);
    }
  }

  function navigateTo(target: ChatNavigation) {
    if (target.fieldKey) {
      window.sessionStorage.setItem(
        PENDING_FIELD_FOCUS_KEY,
        JSON.stringify({
          path: target.path,
          fieldKey: target.fieldKey,
          label: target.label,
        }),
      );
    }
    router.navigate({ to: target.path });
    recordAudit("chat_help", {
      route: window.location.pathname,
      fieldKey: target.fieldKey,
      status: "navigate",
    });
    onClose();
  }

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
            <span className="sr-only">Close help chat</span>
          </button>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto px-4 py-4 text-sm">
          {messages.map((message, index) => (
            <div
              key={index}
              className={
                "rounded-lg p-3 " +
                (message.role === "user"
                  ? "ml-8 bg-primary text-primary-foreground"
                  : "mr-8 bg-muted")
              }
            >
              <p>{message.text}</p>
              {message.blockers && message.blockers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Workflow blockers">
                  {message.blockers.slice(0, 3).map((blocker) => (
                    <span
                      key={blocker}
                      className="rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                    >
                      {blocker}
                    </span>
                  ))}
                </div>
              )}
              {message.navigation && (
                <button
                  type="button"
                  onClick={() => navigateTo(message.navigation as ChatNavigation)}
                  className="mt-3 inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {message.navigation.label}
                </button>
              )}
              {!message.navigation && message.nextActions?.[0] && (
                <button
                  type="button"
                  onClick={() =>
                    navigateTo({
                      path: message.nextActions![0].path,
                      fieldKey: message.nextActions![0].fieldKey,
                      label: message.nextActions![0].label,
                    })
                  }
                  className="mt-3 inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {message.nextActions[0].label}
                </button>
              )}
              {message.citations && message.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1" aria-label="Answer sources">
                  {message.citations.map((citation) => (
                    <span
                      key={citation}
                      className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {citation}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {pending && (
            <p className="mr-8 rounded-lg bg-muted p-3">Checking the provided inputs...</p>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitQuestion();
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={pending}
            aria-disabled={pending}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {pending ? "..." : "Send"}
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
