import {
  DOC_LABELS,
  effectiveHouseholdSize,
  thresholdForHouseholdSize,
  type DocType,
  type SessionState,
} from "@/lib/session-store";
import type { ReferenceEvidence } from "@/lib/evidence-types";
import { appSecurityGuide } from "@/lib/app-security";
import {
  buildChatWorkflowState,
  navigationForQuestionFromWorkflow,
  workflowAnswerForQuestion,
  type ChatNextAction,
  type ChatWorkflowIntent,
  type ChatWorkflowState,
} from "@/lib/chat-workflow";

export const PENDING_FIELD_FOCUS_KEY = "rentsmooth_pending_field_focus";

export type ChatRefusalReason =
  | "decision_request"
  | "protected_trait"
  | "demographic_feature"
  | "behavioral_feature"
  | "landlord_revenue";

export type ChatClassification = { allowed: true } | { allowed: false; reason: ChatRefusalReason };

export interface ChatFieldSnapshot {
  docId: string;
  docType: DocType;
  fileName: string;
  key: string;
  label: string;
  value: string;
  confirmed: boolean;
  sourcePage: number;
}

export interface ChatSessionSnapshot {
  currentRoute: string;
  householdSize: number;
  fields: ChatFieldSnapshot[];
  duplicateIncomeReviews: Array<{
    id: string;
    documentIds: string[];
    reason: string;
    choice?: string;
  }>;
  threshold: ReturnType<typeof thresholdForHouseholdSize>;
  securityGuide: string;
  workflow: ChatWorkflowState;
  referenceEvidence?: ReferenceEvidence;
}

export interface ChatNavigation {
  path: "/" | "/upload" | "/review" | "/confirm" | "/calculation" | "/packet";
  fieldKey?: string;
  label: string;
}

export interface ChatAnswer {
  answer: string;
  refused: boolean;
  reason?: ChatRefusalReason | "openai_unavailable" | "out_of_scope";
  workflowIntent?: ChatWorkflowIntent;
  blockers?: string[];
  nextActions?: ChatNextAction[];
  navigation?: ChatNavigation;
  citations: string[];
}

export function classifyChatRequest(input: string): ChatClassification {
  const text = input.toLowerCase();
  if (
    /\b(decide for me|approve|deny|reject|accept|eligible|ineligible|should i (approve|deny|accept|reject)|rank (the )?applicant|what should the outcome be)\b/.test(
      text,
    )
  ) {
    return { allowed: false, reason: "decision_request" };
  }
  if (
    /\b(race|ethnicity|gender|sex|pregnan|disab|citizenship|immigration|religion|familial status|national origin)\b/.test(
      text,
    )
  ) {
    return { allowed: false, reason: "protected_trait" };
  }
  if (/\b(demographic|neighborhood profile|zip code proxy|age proxy)\b/.test(text)) {
    return { allowed: false, reason: "demographic_feature" };
  }
  if (
    /\b(behavior|behaviour|reliable tenant|likely to pay|risk score|social media|credit personality)\b/.test(
      text,
    )
  ) {
    return { allowed: false, reason: "behavioral_feature" };
  }
  if (
    /\b(landlord revenue|maximize rent|most profitable|profit|yield|eviction revenue)\b/.test(text)
  ) {
    return { allowed: false, reason: "landlord_revenue" };
  }
  return { allowed: true };
}

export function refusalFor(reason: ChatRefusalReason): string {
  switch (reason) {
    case "decision_request":
      return "I cannot decide, approve, deny, rank, or tell you what outcome to choose. I can explain confirmed inputs, extracted fields, the calculation method, and the rule source.";
    case "protected_trait":
      return "I cannot infer or use protected traits. This tool only uses the document fields you review and the published rule.";
    case "demographic_feature":
      return "I cannot use demographic features or proxies. I can only explain uploaded inputs, confirmed fields, and the published rule.";
    case "behavioral_feature":
      return "I cannot infer tenant behavior or create behavioral scores. I can only explain the document review and calculation.";
    case "landlord_revenue":
      return "I cannot optimize for landlord revenue or profitability. I can explain the renter-controlled packet and rule comparison.";
  }
}

export function createChatSnapshot(
  session: SessionState,
  currentRoute: string,
  referenceEvidence?: ReferenceEvidence,
): ChatSessionSnapshot {
  const evidenceMode = referenceEvidence?.fetchedWithTavily
    ? "tavily"
    : referenceEvidence?.evidenceMode === "frozen"
      ? "frozen"
      : "unknown";
  const householdSize = effectiveHouseholdSize(session);
  return {
    currentRoute,
    householdSize,
    fields: session.docs
      .filter((doc) => doc.status !== "skipped")
      .flatMap((doc) =>
        doc.fields
          .filter((field) => field.category !== "untrusted")
          .map((field) => ({
            docId: doc.id,
            docType: doc.type,
            fileName: doc.fileName,
            key: field.key,
            label: field.label,
            value: field.corrected ?? field.value,
            confirmed: field.confirmed,
            sourcePage: field.sourcePage,
          })),
      ),
    duplicateIncomeReviews: session.incomeSourceReviews.map((review) => ({
      id: review.id,
      documentIds: review.documentIds,
      reason: review.reason,
      choice: review.choice,
    })),
    threshold: thresholdForHouseholdSize(householdSize),
    securityGuide: appSecurityGuide,
    workflow: buildChatWorkflowState(session, currentRoute, evidenceMode),
    referenceEvidence,
  };
}

export function fallbackChatAnswer(input: string, snapshot: ChatSessionSnapshot): ChatAnswer {
  const classification = classifyChatRequest(input);
  if (!classification.allowed) {
    return {
      answer: refusalFor(classification.reason),
      refused: true,
      reason: classification.reason,
      workflowIntent: "general",
      blockers: snapshot.workflow.blockers,
      nextActions: [],
      citations: [],
    };
  }

  const text = input.toLowerCase();
  const fieldPageFollowup = fieldNavigationPageFollowup(text, snapshot);
  if (fieldPageFollowup) {
    return {
      answer: fieldPageFollowup,
      refused: false,
      workflowIntent: "field_help",
      blockers: snapshot.workflow.blockers,
      nextActions: snapshot.workflow.nextActions,
      citations: ["Current session fields"],
    };
  }
  const workflow = workflowAnswerForQuestion(text, snapshot);
  return {
    ...workflow,
    refused: false,
  };
}

export function navigationForQuestion(
  text: string,
  snapshot: ChatSessionSnapshot,
): ChatNavigation | undefined {
  return navigationForQuestionFromWorkflow(text, snapshot);
}

export function fieldNavigationPageFollowup(
  text: string,
  snapshot: ChatSessionSnapshot,
): string | undefined {
  const field = fieldForQuestion(text, snapshot);
  if (!field || pageForQuestion(text)) return undefined;
  return `I found the field "${field.label}". Which page should I open for it? Say Review, Confirm, Calculation, or Packet.`;
}

function fieldForQuestion(
  text: string,
  snapshot: ChatSessionSnapshot,
): ChatFieldSnapshot | undefined {
  return snapshot.fields.find(
    (candidate) =>
      text.includes(candidate.key.replace(/_/g, " ")) ||
      text.includes(candidate.label.toLowerCase()) ||
      text.includes(candidate.fileName.toLowerCase()),
  );
}

function pageForQuestion(text: string): ChatNavigation["path"] | undefined {
  if (/\b(home|start|beginning)\b/.test(text)) return "/";
  if (/\b(upload|add document|document upload)\b/.test(text)) return "/upload";
  if (/\b(review|review page|extracted values?)\b/.test(text)) return "/review";
  if (/\b(confirm|confirmation|final review)\b/.test(text)) return "/confirm";
  if (/\b(calculation|calculate|annualized|threshold|hud|rule)\b/.test(text)) {
    return "/calculation";
  }
  if (/\b(packet|export|download|pdf|json)\b/.test(text)) return "/packet";
  return undefined;
}

function pageLabel(path: ChatNavigation["path"]): string {
  switch (path) {
    case "/":
      return "Start";
    case "/upload":
      return "Upload";
    case "/review":
      return "Review";
    case "/confirm":
      return "Confirm";
    case "/calculation":
      return "Calculation";
    case "/packet":
      return "Packet";
  }
}

export function docTypeLabels(): string {
  return Object.values(DOC_LABELS).join(", ");
}
