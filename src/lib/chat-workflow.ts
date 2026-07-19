import {
  DOC_LABELS,
  computeAnnualIncome,
  detectIncomeSourceReviews,
  sameIncomeSourceCanonicalReview,
  type SessionState,
} from "@/lib/session-store";
import type { ChatNavigation, ChatSessionSnapshot } from "@/lib/chat-guardrails";

export type ChatWorkflowIntent =
  | "status"
  | "next_step"
  | "field_help"
  | "calculation_help"
  | "evidence_help"
  | "security_help"
  | "navigation"
  | "general";

export interface ChatNextAction {
  id: string;
  label: string;
  path: ChatNavigation["path"];
  fieldKey?: string;
  priority: number;
}

export interface ChatWorkflowState {
  currentRoute: string;
  confirmedFieldCount: number;
  totalFieldCount: number;
  unconfirmedFields: Array<{ key: string; label: string; docType: string; sourcePage: number }>;
  blockers: string[];
  nextActions: ChatNextAction[];
  calculationErrors: string[];
  packetGenerated: boolean;
  evidenceMode: "tavily" | "frozen" | "unknown";
  unresolvedIncomeReviews: number;
  unresolvedCanonicalReviews: number;
  expiredDocuments: Array<{ fileName: string; docType: string; documentDate?: string }>;
}

export function buildChatWorkflowState(
  session: SessionState,
  currentRoute: string,
  evidenceMode: ChatWorkflowState["evidenceMode"] = "unknown",
): ChatWorkflowState {
  const fields = session.docs
    .filter((doc) => doc.status !== "skipped")
    .flatMap((doc) =>
      doc.fields.filter((field) => field.category !== "untrusted").map((field) => ({ field, doc })),
    );
  const unconfirmedFields = fields
    .filter(({ field }) => !field.confirmed)
    .map(({ field, doc }) => ({
      key: field.key,
      label: field.label,
      docType: DOC_LABELS[doc.type],
      sourcePage: field.sourcePage,
    }));
  const reviews = detectIncomeSourceReviews(session);
  const unresolvedIncomeReviews = reviews.filter((review) => !review.choice).length;
  const unresolvedCanonicalReviews = reviews.filter(
    (review) => sameIncomeSourceCanonicalReview(session, review).requiresCanonicalConfirmation,
  ).length;
  const calculation = computeAnnualIncome(session);
  const expiredDocuments = session.docs
    .filter((doc) => doc.status === "expired")
    .map((doc) => ({
      fileName: doc.fileName,
      docType: DOC_LABELS[doc.type],
      documentDate: doc.documentDate,
    }));

  const blockers = [
    unconfirmedFields.length > 0
      ? `${unconfirmedFields.length} extracted value${unconfirmedFields.length === 1 ? "" : "s"} still need confirmation.`
      : "",
    unresolvedIncomeReviews > 0
      ? `${unresolvedIncomeReviews} income source question${unresolvedIncomeReviews === 1 ? "" : "s"} still need review.`
      : "",
    unresolvedCanonicalReviews > 0
      ? `${unresolvedCanonicalReviews} same income source conflict${unresolvedCanonicalReviews === 1 ? "" : "s"} need canonical values.`
      : "",
    ...calculation.errors,
  ].filter(Boolean);

  const nextActions = buildNextActions({
    unconfirmedFields,
    unresolvedIncomeReviews,
    unresolvedCanonicalReviews,
    calculationErrors: calculation.errors,
    packetGenerated: !!session.packetGeneratedAt,
  });

  return {
    currentRoute,
    confirmedFieldCount: fields.filter(({ field }) => field.confirmed).length,
    totalFieldCount: fields.length,
    unconfirmedFields,
    blockers: uniqueStrings(blockers),
    nextActions,
    calculationErrors: calculation.errors,
    packetGenerated: !!session.packetGeneratedAt,
    evidenceMode,
    unresolvedIncomeReviews,
    unresolvedCanonicalReviews,
    expiredDocuments,
  };
}

export function workflowAnswerForQuestion(
  input: string,
  snapshot: ChatSessionSnapshot,
): {
  answer: string;
  workflowIntent: ChatWorkflowIntent;
  blockers: string[];
  nextActions: ChatNextAction[];
  navigation?: ChatNavigation;
  citations: string[];
} {
  const text = input.toLowerCase();
  const workflow = snapshot.workflow;
  const field = fieldForQuestion(text, snapshot);
  const navigation = navigationForQuestionFromWorkflow(text, snapshot);

  if (field) {
    return {
      answer: `${field.label} is ${field.value}. It came from ${DOC_LABELS[field.docType]}, page ${field.sourcePage}, and is ${field.confirmed ? "confirmed" : "not confirmed yet"}.`,
      workflowIntent: "field_help",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation,
      citations: ["Current session fields"],
    };
  }

  if (/\b(next|what should i do|what do i do|continue|where now)\b/.test(text)) {
    const primary = workflow.nextActions[0];
    return {
      answer: primary
        ? `Next step: ${primary.label}.`
        : "No required next step is currently blocking the packet workflow.",
      workflowIntent: "next_step",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation: primary ? actionToNavigation(primary) : navigation,
      citations: ["Current workflow state"],
    };
  }

  if (
    /\b(why.*can.?t|blocked|blocker|cannot continue|can't continue|disagree|conflict)\b/.test(text)
  ) {
    return {
      answer:
        workflow.blockers.length > 0
          ? `Progress is blocked by: ${workflow.blockers.join(" ")}`
          : "There are no current workflow blockers.",
      workflowIntent: "status",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation: workflow.nextActions[0]
        ? actionToNavigation(workflow.nextActions[0])
        : navigation,
      citations: ["Current workflow state"],
    };
  }

  if (/\b(calculation|annualized|income|threshold|compare)\b/.test(text)) {
    const threshold = snapshot.threshold;
    return {
      answer:
        workflow.calculationErrors.length > 0
          ? `Calculation is not ready: ${workflow.calculationErrors.join(" ")} The rule threshold is ${threshold.label}, effective ${threshold.effective}.`
          : `Calculation uses confirmed income values and compares annualized income to ${threshold.label}, effective ${threshold.effective}.`,
      workflowIntent: "calculation_help",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation: navigation ?? { path: "/calculation", label: "Go to calculation" },
      citations: ["Current calculation", "HUD reference evidence"],
    };
  }

  if (/\b(hud|rule|evidence|citation|tavily|source|limit)\b/.test(text)) {
    return {
      answer: `${snapshot.threshold.source} is the rule source. Evidence mode is ${workflow.evidenceMode === "tavily" ? "Tavily Extract from allowlisted HUD URLs" : workflow.evidenceMode === "frozen" ? "frozen local HUD reference" : "the configured HUD reference"}. The threshold shown is ${snapshot.threshold.label}, effective ${snapshot.threshold.effective}.`,
      workflowIntent: "evidence_help",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation: navigation ?? { path: "/calculation", label: "Go to calculation" },
      citations: ["HUD reference evidence"],
    };
  }

  if (/\b(security|privacy|private|stored|storage|delete|clear|api key|openai)\b/.test(text)) {
    return {
      answer:
        "Security summary: document text is treated as untrusted data, values are used only after confirmation, chat receives a sanitized snapshot, and the server keeps the OpenAI API key private. I can navigate or explain, but I cannot change values.",
      workflowIntent: "security_help",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation,
      citations: ["RentSmooth App Security Guide"],
    };
  }

  if (/\b(status|progress|confirmed|done)\b/.test(text)) {
    return {
      answer: `${workflow.confirmedFieldCount} of ${workflow.totalFieldCount} extracted values are confirmed. ${workflow.blockers.length > 0 ? `Current blockers: ${workflow.blockers.join(" ")}` : "There are no current workflow blockers."}`,
      workflowIntent: "status",
      blockers: workflow.blockers,
      nextActions: workflow.nextActions,
      navigation,
      citations: ["Current workflow state"],
    };
  }

  return {
    answer:
      "I can inspect the current packet workflow, explain blockers, explain fields and evidence, and navigate to the next renter-controlled step. I cannot change or confirm values for you.",
    workflowIntent: navigation ? "navigation" : "general",
    blockers: workflow.blockers,
    nextActions: workflow.nextActions,
    navigation,
    citations: ["Current workflow state"],
  };
}

export function sanitizeWorkflowCitations(
  citations: string[],
  snapshot: ChatSessionSnapshot,
): string[] {
  const allowed = new Set([
    "Current session fields",
    "Current workflow state",
    "Current calculation",
    "Current session controls",
    "HUD reference evidence",
    "RentSmooth App Security Guide",
    ...(snapshot.referenceEvidence?.chunks.map((chunk) => chunk.id) ?? []),
  ]);
  return citations.filter((citation) => allowed.has(citation)).slice(0, 5);
}

export function navigationForQuestionFromWorkflow(
  text: string,
  snapshot: ChatSessionSnapshot,
): ChatNavigation | undefined {
  const field = fieldForQuestion(text, snapshot);
  if (field) {
    const path = pageForQuestion(text);
    if (!path) return undefined;
    return { path, fieldKey: field.key, label: `Go to ${field.label} on ${pageLabel(path)}` };
  }
  if (/\b(upload|add document|document)\b/.test(text))
    return { path: "/upload", label: "Go to upload" };
  if (/\b(review|field|confirm value|duplicate|conflict|disagree)\b/.test(text)) {
    return { path: "/review", label: "Go to review" };
  }
  if (/\b(final|confirm information)\b/.test(text)) {
    return { path: "/confirm", label: "Go to final confirmation" };
  }
  if (/\b(calculation|annualized|threshold|hud|rule)\b/.test(text)) {
    return { path: "/calculation", label: "Go to calculation" };
  }
  if (/\b(packet|export|download)\b/.test(text)) return { path: "/packet", label: "Go to packet" };
  return undefined;
}

function buildNextActions({
  unconfirmedFields,
  unresolvedIncomeReviews,
  unresolvedCanonicalReviews,
  calculationErrors,
  packetGenerated,
}: {
  unconfirmedFields: ChatWorkflowState["unconfirmedFields"];
  unresolvedIncomeReviews: number;
  unresolvedCanonicalReviews: number;
  calculationErrors: string[];
  packetGenerated: boolean;
}): ChatNextAction[] {
  if (unconfirmedFields.length > 0) {
    const first = unconfirmedFields[0];
    return [
      {
        id: "confirm_first_field",
        label: `Review ${first.label}`,
        path: "/review",
        fieldKey: first.key,
        priority: 1,
      },
    ];
  }
  if (unresolvedIncomeReviews > 0) {
    return [
      {
        id: "resolve_income_source",
        label: "Review income source question",
        path: "/review",
        priority: 1,
      },
    ];
  }
  if (unresolvedCanonicalReviews > 0) {
    return [
      {
        id: "resolve_canonical_income",
        label: "Save same income source values",
        path: "/review",
        priority: 1,
      },
    ];
  }
  if (calculationErrors.length > 0) {
    return [
      {
        id: "review_calculation_blocker",
        label: "Review calculation blockers",
        path: "/calculation",
        priority: 2,
      },
    ];
  }
  if (!packetGenerated) {
    return [{ id: "open_packet", label: "Open packet", path: "/packet", priority: 3 }];
  }
  return [];
}

function actionToNavigation(action: ChatNextAction): ChatNavigation {
  return { path: action.path, fieldKey: action.fieldKey, label: action.label };
}

function fieldForQuestion(text: string, snapshot: ChatSessionSnapshot) {
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
  if (/\b(calculation|calculate|annualized|threshold|hud|rule)\b/.test(text)) return "/calculation";
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
