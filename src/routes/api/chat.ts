import { createFileRoute } from "@tanstack/react-router";
import {
  classifyChatRequest,
  fieldNavigationPageFollowup,
  fallbackChatAnswer,
  navigationForQuestion,
  refusalFor,
  type ChatAnswer,
  type ChatSessionSnapshot,
} from "@/lib/chat-guardrails";
import {
  sanitizeWorkflowCitations,
  workflowAnswerForQuestion,
  type ChatWorkflowState,
} from "@/lib/chat-workflow";
import { appSecurityGuide } from "@/lib/app-security";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.1";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { question?: unknown; snapshot?: unknown };
        try {
          payload = (await request.json()) as { question?: unknown; snapshot?: unknown };
        } catch {
          return Response.json({ error: "Invalid chat request." }, { status: 400 });
        }

        if (typeof payload.question !== "string" || payload.question.trim().length === 0) {
          return Response.json({ error: "Missing question." }, { status: 400 });
        }
        const question = payload.question.trim().slice(0, 1000);
        const snapshot = sanitizeSnapshot(payload.snapshot);
        if (!snapshot) {
          return Response.json({ error: "Missing session snapshot." }, { status: 400 });
        }

        const classification = classifyChatRequest(question);
        if (!classification.allowed) {
          return Response.json({
            answer: refusalFor(classification.reason),
            refused: true,
            reason: classification.reason,
            workflowIntent: "general",
            blockers: snapshot.workflow.blockers,
            nextActions: [],
            citations: [],
          } satisfies ChatAnswer);
        }

        const fieldPageFollowup = fieldNavigationPageFollowup(question.toLowerCase(), snapshot);
        if (fieldPageFollowup) {
          return Response.json({
            answer: fieldPageFollowup,
            refused: false,
            reason: undefined,
            workflowIntent: "field_help",
            blockers: snapshot.workflow.blockers,
            nextActions: snapshot.workflow.nextActions,
            navigation: undefined,
            citations: ["Current session fields"],
          } satisfies ChatAnswer);
        }

        if (!process.env.OPENAI_API_KEY) {
          return Response.json({
            ...fallbackChatAnswer(question, snapshot),
            reason: "openai_unavailable",
          } satisfies ChatAnswer);
        }

        try {
          const answer = await askOpenAI(question, snapshot);
          return Response.json(answer);
        } catch (error) {
          const fallback = fallbackChatAnswer(question, snapshot);
          return Response.json({
            ...fallback,
            answer: `${fallback.answer} OpenAI chat is temporarily unavailable, so this answer used the local guardrail fallback.`,
            reason: "openai_unavailable",
          } satisfies ChatAnswer);
        }
      },
    },
  },
});

function sanitizeSnapshot(input: unknown): ChatSessionSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as ChatSessionSnapshot;
  const currentRoute =
    typeof raw.currentRoute === "string" && /^\/[a-z0-9/_-]*$/i.test(raw.currentRoute)
      ? raw.currentRoute
      : "/";
  const fields = Array.isArray(raw.fields)
    ? raw.fields.slice(0, 80).map((field) => ({
        docId: String(field.docId ?? "").slice(0, 120),
        docType: field.docType,
        fileName: String(field.fileName ?? "").slice(0, 160),
        key: String(field.key ?? "").slice(0, 80),
        label: String(field.label ?? "").slice(0, 120),
        value: String(field.value ?? "").slice(0, 240),
        confirmed: Boolean(field.confirmed),
        sourcePage: Number(field.sourcePage) || 1,
      }))
    : [];
  return {
    currentRoute,
    householdSize: Number(raw.householdSize) || 1,
    fields,
    duplicateIncomeReviews: Array.isArray(raw.duplicateIncomeReviews)
      ? raw.duplicateIncomeReviews.slice(0, 20).map((review) => ({
          id: String(review.id ?? "").slice(0, 160),
          documentIds: Array.isArray(review.documentIds)
            ? review.documentIds.map((id) => String(id).slice(0, 120)).slice(0, 12)
            : [],
          reason: String(review.reason ?? "").slice(0, 500),
          choice: review.choice ? String(review.choice).slice(0, 80) : undefined,
        }))
      : [],
    threshold: raw.threshold,
    securityGuide: appSecurityGuide.slice(0, 5000),
    workflow: sanitizeWorkflowState(raw.workflow, currentRoute),
    referenceEvidence: raw.referenceEvidence
      ? {
          ...raw.referenceEvidence,
          chunks: Array.isArray(raw.referenceEvidence.chunks)
            ? raw.referenceEvidence.chunks.slice(0, 6).map((chunk) => ({
                ...chunk,
                text: String(chunk.text ?? "").slice(0, 500),
              }))
            : [],
        }
      : undefined,
  };
}

function sanitizeWorkflowState(input: unknown, currentRoute: string): ChatWorkflowState {
  const raw = input && typeof input === "object" ? (input as Partial<ChatWorkflowState>) : {};
  const blockers = Array.isArray(raw.blockers)
    ? raw.blockers.map((item) => String(item).slice(0, 240)).slice(0, 20)
    : [];
  return {
    currentRoute,
    confirmedFieldCount: Number(raw.confirmedFieldCount) || 0,
    totalFieldCount: Number(raw.totalFieldCount) || 0,
    unconfirmedFields: Array.isArray(raw.unconfirmedFields)
      ? raw.unconfirmedFields.slice(0, 80).map((field) => ({
          key: String(field.key ?? "").slice(0, 80),
          label: String(field.label ?? "").slice(0, 120),
          docType: String(field.docType ?? "").slice(0, 80),
          sourcePage: Number(field.sourcePage) || 1,
        }))
      : [],
    blockers,
    nextActions: Array.isArray(raw.nextActions)
      ? raw.nextActions.slice(0, 8).map((action) => ({
          id: String(action.id ?? "").slice(0, 80),
          label: String(action.label ?? "").slice(0, 120),
          path: isKnownPath(action.path) ? action.path : "/review",
          fieldKey: action.fieldKey ? String(action.fieldKey).slice(0, 80) : undefined,
          priority: Number(action.priority) || 1,
        }))
      : [],
    calculationErrors: Array.isArray(raw.calculationErrors)
      ? raw.calculationErrors.map((item) => String(item).slice(0, 240)).slice(0, 20)
      : [],
    packetGenerated: Boolean(raw.packetGenerated),
    evidenceMode:
      raw.evidenceMode === "tavily" || raw.evidenceMode === "frozen" ? raw.evidenceMode : "unknown",
    unresolvedIncomeReviews: Number(raw.unresolvedIncomeReviews) || 0,
    unresolvedCanonicalReviews: Number(raw.unresolvedCanonicalReviews) || 0,
    expiredDocuments: Array.isArray(raw.expiredDocuments)
      ? raw.expiredDocuments.slice(0, 20).map((doc) => ({
          fileName: String(doc.fileName ?? "").slice(0, 160),
          docType: String(doc.docType ?? "").slice(0, 80),
          documentDate: doc.documentDate ? String(doc.documentDate).slice(0, 20) : undefined,
        }))
      : [],
  };
}

function isKnownPath(path: unknown): path is ChatWorkflowState["nextActions"][number]["path"] {
  return (
    path === "/" ||
    path === "/upload" ||
    path === "/review" ||
    path === "/confirm" ||
    path === "/calculation" ||
    path === "/packet"
  );
}

async function askOpenAI(question: string, snapshot: ChatSessionSnapshot): Promise<ChatAnswer> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                question,
                snapshot,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
      max_output_tokens: 700,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}.`);
  }
  const payload = (await response.json()) as { output_text?: string; output?: unknown[] };
  const text = payload.output_text ?? extractOutputText(payload.output);
  const parsed = JSON.parse(text) as Partial<ChatAnswer>;
  if (!parsed || typeof parsed.answer !== "string") {
    throw new Error("OpenAI returned an invalid chat answer.");
  }
  const local = workflowAnswerForQuestion(question, snapshot);
  const deterministicNavigation = navigationForQuestion(question.toLowerCase(), snapshot);
  return {
    answer: parsed.answer || local.answer,
    refused: Boolean(parsed.refused),
    reason: parsed.reason ?? undefined,
    workflowIntent: local.workflowIntent,
    blockers: local.blockers,
    nextActions: local.nextActions,
    navigation: deterministicNavigation ?? local.navigation ?? undefined,
    citations: sanitizeWorkflowCitations(
      Array.isArray(parsed.citations) && parsed.citations.length > 0
        ? parsed.citations
        : local.citations,
      snapshot,
    ),
  };
}

function extractOutputText(output: unknown[] | undefined): string {
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

function systemPrompt(): string {
  return [
    "You are SimplePath Help Chat. Answer only from the JSON snapshot provided by the user message.",
    "Allowed sources are: extracted/uploaded input fields, confirmed/corrected values, duplicate-income review choices, snapshot.securityGuide, and allowlisted HUD reference chunks in the snapshot.",
    "Never infer missing values. If a value is not present, say it is not in the provided inputs.",
    "Never decide, approve, deny, rank, recommend an outcome, or tell the user what decision to make.",
    "Never infer protected traits or use demographic, behavioral, tenant-risk, or landlord-revenue/profit features.",
    "Never change values. You may return a navigation suggestion only.",
    "Act as a bounded workflow assistant: inspect snapshot.workflow, name current blockers, suggest one renter-controlled next action, and cite only allowed snapshot labels.",
    "If the user asks to go to a specific field, do not navigate unless the user also names the page: Review, Confirm, Calculation, or Packet. If the page is missing, ask which page to open.",
    "For security questions, follow snapshot.securityGuide.",
    'Return only JSON with keys: "answer" string, "refused" boolean, "reason" string or null, "workflowIntent" string, "blockers" array of strings, "nextActions" array, "navigation" object or null, and "citations" array of strings. Put null for navigation when no useful navigation exists.',
  ].join(" ");
}
