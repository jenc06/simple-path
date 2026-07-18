import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type DocType =
  | "application_form"
  | "pay_stub"
  | "benefit_letter"
  | "employment_letter"
  | "gig_statement";

export const DOC_LABELS: Record<DocType, string> = {
  application_form: "Application form",
  pay_stub: "Pay stub",
  benefit_letter: "Benefit letter",
  employment_letter: "Employment letter",
  gig_statement: "Gig work statement",
};

export type DocStatus = "uploaded" | "skipped" | "expired";

export interface ExtractedField {
  id: string;
  label: string;
  value: string;
  confidence: number; // 0-100
  sourceDoc: DocType;
  sourcePage: number;
  bbox: { x: number; y: number; w: number; h: number }; // % of page
  confirmed: boolean;
  corrected?: string;
}

export interface UploadedDoc {
  id: string;
  type: DocType;
  fileName: string;
  status: DocStatus;
  documentDate?: string; // ISO
  fields: ExtractedField[];
}

export interface SessionState {
  startedAt: string;
  docs: UploadedDoc[];
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly" | "unknown";
  householdSize: number;
}

// Cutoff: More than 60 days before July 18, 2026 => before May 19, 2026
export const TODAY = "2026-07-18";
export const DATE_CUTOFF = "2026-05-19";

const initialSample = (): SessionState => ({
  startedAt: new Date().toISOString(),
  frequency: "biweekly",
  householdSize: 1,
  docs: [
    {
      id: "d1",
      type: "pay_stub",
      fileName: "paystub_june_2026.pdf",
      status: "uploaded",
      documentDate: "2026-06-30",
      fields: [
        {
          id: "f1",
          label: "Pay before taxes",
          value: "$2,166.00",
          confidence: 96,
          sourceDoc: "pay_stub",
          sourcePage: 1,
          bbox: { x: 55, y: 34, w: 30, h: 6 },
          confirmed: false,
        },
        {
          id: "f2",
          label: "Pay frequency",
          value: "Every 2 weeks",
          confidence: 91,
          sourceDoc: "pay_stub",
          sourcePage: 1,
          bbox: { x: 12, y: 46, w: 28, h: 6 },
          confirmed: false,
        },
      ],
    },
  ],
});

interface Ctx {
  session: SessionState;
  setSession: (fn: (s: SessionState) => SessionState) => void;
  confirmField: (id: string, corrected?: string) => void;
  resetSession: () => void;
  deleteSession: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionState>(initialSample);

  const value = useMemo<Ctx>(
    () => ({
      session,
      setSession: (fn) => setSessionState(fn),
      confirmField: (id, corrected) =>
        setSessionState((s) => ({
          ...s,
          docs: s.docs.map((d) => ({
            ...d,
            fields: d.fields.map((f) =>
              f.id === id ? { ...f, confirmed: true, corrected } : f,
            ),
          })),
        })),
      resetSession: () => setSessionState(initialSample()),
      deleteSession: () =>
        setSessionState({
          startedAt: new Date().toISOString(),
          frequency: "unknown",
          householdSize: 1,
          docs: [],
        }),
    }),
    [session],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export function allFields(s: SessionState): ExtractedField[] {
  return s.docs.flatMap((d) => d.fields);
}

export function parseAmount(v: string): number {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export function frequencyMultiplier(f: SessionState["frequency"]): number | null {
  switch (f) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
    default:
      return null;
  }
}

export const THRESHOLD = {
  amount: 72000,
  label: "60% income limit for 1-person household",
  source: "HUD FY 2026 MTSP Income Limits",
  effective: "May 1, 2026",
  page: 130,
  url: "https://www.huduser.gov/portal/datasets/mtsp/mtsp26/HERA-Income-Limits-Report-FY26.pdf",
};
