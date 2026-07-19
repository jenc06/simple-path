## Overhaul Review, Confirm, and Calculation

### Review page — group by value, not by document

Rebuild `src/routes/review.tsx` so cards are grouped into two sections only:

1. **Basic values** (name, household size, address, application date, letter dates, pay dates, frequency, etc.)
2. **Values used for calculation** (gross pay, net pay, hourly rate, hours, monthly benefit, gross receipts, platform fees).

Merging logic (in a new helper in `src/lib/session-store.tsx`, `mergedFields(session)`):
- Group all extracted fields across every uploaded doc by a normalized key (e.g. `person_name`, `hourly_rate`, `gross_pay`). Cross-doc keys like `person_name`/`hourly_rate` collapse into one card even if they came from two docs.
- Each merged card carries an array of **sources** (docId, docType, page, bbox, value, confidence). The card's displayed value defaults to the highest-confidence source; user corrections still win.
- Confirming a merged card confirms all underlying fields at once (new `confirmMerged(mergedId, corrected?)` action).

Card behavior (updated `src/components/value-card.tsx`):
- Larger card (min height ~ viewport - sticky preview) so **only one unconfirmed card is visible at a time**; the next one appears via scroll or auto-scroll on confirm.
- If a merged card has >1 source, show a small **source toggle** row at the top (chips: "Pay stub p.1", "Employment letter p.1"). Clicking a chip switches the sticky preview's yellow box to that source. Every source is announced in text, not color.
- **Warning ribbon** when the field's source document date (or the field value itself, if it's a date) is more than 6 months before `TODAY` (2026-07-18, cutoff 2026-01-18): amber banner with text "Older than 6 months — double-check this is current." Not color-only; icon + text.
- Once confirmed, the card **moves to the bottom** of its section (sort: unconfirmed first by original order, confirmed last). The next unconfirmed card in the same section becomes active automatically.
- When the **last card in a section** is confirmed, smooth-scroll to the first unconfirmed card in the next section and announce "Basic values complete. Moving to values used for calculation."

Untrusted / suspicious card (`src/components/untrusted-card.tsx`):
- Read-only. Remove any confirm / edit / reset controls entirely.
- No "Confirmed" state ever. Label chip reads **"Suspicious — ignored"** in red with an icon + text.
- Keep it in its own **"Safety check"** section under the two main sections; it does not count toward the progress bar or block "Continue".

Progress bar counts only trusted merged cards (basic + calculation). "Continue" enables when all trusted merged cards are confirmed.

### Confirm page — compact key/value layout

Rewrite `src/routes/confirm.tsx`:
- Two grouped sections mirroring Review: **Basic info** and **Values used for calculation**.
- Basic info renders as a tight **definition list**: `Applicant name: Jordan Rivera`, `Household size: 1`, `Address: 482 Maple St…`, one row per line, label on the left in muted text and the value on the right in medium weight. No large emphasis on the value alone.
- Calculation values render the same compact way, one row per value.
- Each row still has an inline **Edit** button that opens `EditableValue` in place; "Show source" collapses by default and only appears when the row is expanded, so the page reads at a glance.
- Suspicious items are not shown here at all (they're already ignored).
- Keep the two bottom buttons ("Yes, this information is correct" / "Go back and change something").

### Change log (every edit, not just from original)

Extend `ExtractedField` (and the merged wrapper) with `history: { at: string; from: string; to: string }[]`.
- `confirmField` / `confirmMerged` push a new entry each time the value changes, comparing against the **previous** value (last history entry's `to`, or `value` if none), not the original OCR value.
- `ValueCard` and `EditableValue` show "Changed from X to Y" using the most recent history entry.
- Optional collapsed "Full history" list under the card (small muted text) when history length > 1.

### Calculation page — fix "No confirmed income amount"

Root cause (verified in `src/routes/calculation.tsx` line 33): it searches for a field whose label contains `"pay before"`, but no such label exists — `FIELD_SPECS` only defines `Gross pay`, `Net pay`, `Hourly rate`, `Weekly hours`, `Monthly benefit amount`, `Gross receipts`, `Platform fees`. So `payField` is always `undefined` → error.

Fix by picking a real confirmed income field, in this priority order:
1. Confirmed `gross_pay` from any pay stub (per-period, use `session.frequency` multiplier).
2. Confirmed `hourly_rate` × `weekly_hours` from an employment letter → weekly → ×52.
3. Confirmed `monthly_benefit` → ×12 (force frequency label "monthly" for display).
4. Confirmed `gross_receipts − platform_fees` from a gig statement → treat as monthly → ×12.

If **multiple** income sources are confirmed, sum their annualized equivalents and show a small breakdown ("Pay stub gross × 26 + Monthly benefit × 12 = …"). Frequency dropdown only applies to pay-stub-style per-period amounts; when only benefit/gig sources exist, hide the frequency row and label the formula accordingly.

The "Confirmed income" editable row shows the field(s) actually used, each with its own `EditableValue` so edits still flow back into the merged store.

### Technical notes

- New helpers in `src/lib/session-store.tsx`: `mergedFields`, `confirmMerged`, `computeAnnualIncome(session)` returning `{ annual, breakdown[], errors[] }`. Calculation page consumes `computeAnnualIncome` instead of inline logic.
- Auto-scroll uses `element.scrollIntoView({ behavior: "smooth", block: "start" })` plus a `LiveRegion` announcement; respects `prefers-reduced-motion` (fall back to instant scroll).
- Warning threshold: `TODAY − 6 months = 2026-01-18`. Uses each source's `documentDate` (already captured at upload) or, for date-typed fields, the field value itself.
- No backend changes; everything stays client-side in the session store.

### Files touched

- `src/lib/session-store.tsx` (merging, history, annual income, warnings)
- `src/routes/review.tsx` (two-section layout, auto-advance, auto-scroll, source toggle)
- `src/components/value-card.tsx` (bigger card, source chips, 6-month warning, history line)
- `src/components/untrusted-card.tsx` (read-only, "Suspicious — ignored" label)
- `src/routes/confirm.tsx` (compact key/value layout)
- `src/routes/calculation.tsx` (use `computeAnnualIncome`, remove `pay before` lookup)
