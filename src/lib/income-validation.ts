export type NumericFieldKey =
  | "household_size"
  | "gross_pay"
  | "net_pay"
  | "hourly_rate"
  | "regular_hours"
  | "weekly_hours"
  | "monthly_benefit"
  | "gross_receipts"
  | "platform_fees";

export interface NumericValidationResult {
  ok: boolean;
  value?: number;
  normalized?: string;
  error?: string;
}

interface NumericRule {
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  money?: boolean;
}

const NUMERIC_RULES: Record<NumericFieldKey, NumericRule> = {
  household_size: { label: "Household size", min: 1, max: 8, integer: true },
  gross_pay: { label: "Gross pay", min: 0, max: 1000000, money: true },
  net_pay: { label: "Net pay", min: 0, max: 1000000, money: true },
  hourly_rate: { label: "Hourly rate", min: 0, max: 10000, money: true },
  regular_hours: { label: "Regular hours", min: 0, max: 744 },
  weekly_hours: { label: "Weekly hours", min: 0, max: 168 },
  monthly_benefit: { label: "Monthly benefit", min: 0, max: 1000000, money: true },
  gross_receipts: { label: "Gross receipts", min: 0, max: 1000000, money: true },
  platform_fees: { label: "Platform fees", min: 0, max: 1000000, money: true },
};

const NUMERIC_FIELD_KEYS = new Set<string>(Object.keys(NUMERIC_RULES));

export function isNumericFieldKey(key: string): key is NumericFieldKey {
  return NUMERIC_FIELD_KEYS.has(key);
}

export function validateNumericField(key: string, raw: string): NumericValidationResult {
  if (!isNumericFieldKey(key)) return { ok: true, normalized: raw };
  const rule = NUMERIC_RULES[key];
  const parsed = parseStrictNumeric(raw, rule.money ?? false);
  if (parsed === null) {
    return { ok: false, error: `${rule.label} must be a number.` };
  }
  if (parsed < rule.min) {
    return { ok: false, error: `${rule.label} cannot be negative.` };
  }
  if (parsed > rule.max) {
    return { ok: false, error: `${rule.label} is too large to use safely.` };
  }
  if (rule.integer && !Number.isInteger(parsed)) {
    return { ok: false, error: `${rule.label} must be a whole number.` };
  }
  return {
    ok: true,
    value: parsed,
    normalized: rule.money ? formatCurrencyValue(parsed) : formatPlainNumericValue(parsed),
  };
}

export function parseValidatedAmount(raw: string): number {
  const parsed = parseStrictNumeric(raw, true);
  return parsed === null || parsed < 0 ? NaN : parsed;
}

export function parseValidatedNumber(raw: string): number {
  const parsed = parseStrictNumeric(raw, false);
  return parsed === null || parsed < 0 ? NaN : parsed;
}

function parseStrictNumeric(raw: string, money: boolean): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[a-z]/i.test(trimmed)) return null;
  if (/[()]/.test(trimmed)) return null;
  const pattern = money
    ? /^-?\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/
    : /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(trimmed)) return null;
  const n = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatCurrencyValue(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPlainNumericValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toString();
}
