import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

function loadValidationModule() {
  const source = readFileSync(resolve("src/lib/income-validation.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const fn = new Function("module", "exports", compiled);
  fn(module, module.exports);
  return module.exports;
}

const validation = loadValidationModule();

test("numeric validation rejects malformed and unsafe income values", () => {
  const cases = [
    ["gross_pay", "-1", "Gross pay cannot be negative."],
    ["gross_pay", "abc", "Gross pay must be a number."],
    ["gross_pay", "$1,200abc", "Gross pay must be a number."],
    ["gross_pay", "1.234", "Gross pay must be a number."],
    ["gross_pay", "1,20,0", "Gross pay must be a number."],
    ["gross_pay", "1-2", "Gross pay must be a number."],
    ["gross_pay", "$1,000,000.01", "Gross pay is too large to use safely."],
    ["weekly_hours", "169", "Weekly hours is too large to use safely."],
    ["regular_hours", "745", "Regular hours is too large to use safely."],
    ["hourly_rate", "$10,000.01", "Hourly rate is too large to use safely."],
    ["household_size", "0", "Household size cannot be negative."],
    ["household_size", "9", "Household size is too large to use safely."],
    ["household_size", "2.5", "Household size must be a whole number."],
    ["monthly_benefit", "($100)", "Monthly benefit must be a number."],
    ["platform_fees", "-0.01", "Platform fees cannot be negative."],
    ["gross_receipts", "Infinity", "Gross receipts must be a number."],
  ];

  for (const [key, raw, error] of cases) {
    assert.deepEqual(
      validation.validateNumericField(key, raw),
      { ok: false, error },
      `${key} ${raw}`,
    );
  }
});

test("numeric validation accepts and normalizes safe values", () => {
  assert.deepEqual(validation.validateNumericField("gross_pay", "$2,166.00"), {
    ok: true,
    value: 2166,
    normalized: "$2,166.00",
  });
  assert.deepEqual(validation.validateNumericField("hourly_rate", "28.5"), {
    ok: true,
    value: 28.5,
    normalized: "$28.50",
  });
  assert.deepEqual(validation.validateNumericField("weekly_hours", "38"), {
    ok: true,
    value: 38,
    normalized: "38",
  });
  assert.deepEqual(validation.validateNumericField("household_size", "4"), {
    ok: true,
    value: 4,
    normalized: "4",
  });
});

test("defensive parsers never coerce words or negative values into usable numbers", () => {
  assert.ok(Number.isNaN(validation.parseValidatedAmount("abc123")));
  assert.ok(Number.isNaN(validation.parseValidatedAmount("-123")));
  assert.ok(Number.isNaN(validation.parseValidatedAmount("1.234")));
  assert.ok(Number.isNaN(validation.parseValidatedNumber("12 hours")));
  assert.equal(validation.parseValidatedAmount("$1,234.50"), 1234.5);
  assert.equal(validation.parseValidatedNumber("38.5"), 38.5);
});

test("income validation is wired into UI edits and calculation", () => {
  const sessionStore = readFileSync(resolve("src/lib/session-store.tsx"), "utf8");
  const editableValue = readFileSync(resolve("src/components/editable-value.tsx"), "utf8");
  const valueCard = readFileSync(resolve("src/components/value-card.tsx"), "utf8");
  const mergedValueCard = readFileSync(resolve("src/components/merged-value-card.tsx"), "utf8");
  const confirmRoute = readFileSync(resolve("src/routes/confirm.tsx"), "utf8");
  const reviewRoute = readFileSync(resolve("src/routes/review.tsx"), "utf8");

  assert.match(sessionStore, /incomeInputValidationErrors/);
  assert.match(sessionStore, /parseValidatedAmount/);
  assert.match(sessionStore, /platform fees cannot be greater than gross receipts/);
  assert.match(sessionStore, /pay frequency is needed to annualize gross pay/);
  for (const source of [editableValue, valueCard, mergedValueCard, confirmRoute, reviewRoute]) {
    assert.match(source, /validateNumericField/);
  }
});
