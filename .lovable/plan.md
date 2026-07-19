## Rename to SimplePath
Replace every "RentSmooth" string with "SimplePath" across UI, metadata, PDF, chat system prompt, security guide, and page titles. Files: `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/upload.tsx`, `src/routes/review.tsx`, `src/routes/confirm.tsx`, `src/routes/calculation.tsx`, `src/routes/packet.tsx`, `src/components/page-shell.tsx`, `src/components/untrusted-card.tsx`, `src/lib/chat-workflow.ts`, `src/routes/api/chat.ts`, `src/content/app-security.md`. (Keep JSON export filename `simplepath-packet.json`.)

## Upload page
- **Require an application document too**: `canFinish` in `src/routes/upload.tsx` must also require a confirmed `application_form` upload, not just an income document. Update the disabled-state helper text and `aria-describedby` warning to name both requirements explicitly ("Not allowed — add an application form and an income document").
- **Remove "I'm done uploading!" button entirely.** The user proceeds via the existing checklist "Continue to review" affordance. If that path only exists through the finish button, replace the button label/behavior with a plain link/button that navigates only when both requirements are met; when not met, do not render a proceed button at all and instead render a clear text block: "Not allowed yet — add an application form and one income document before continuing." (No disabled button.)
- **Explicit "not allowed" wording**: Every place we currently gray-out a button or rely on the ⊘ icon must include the words "Not allowed" plus the reason.
- **Ban icon tooltip/label**: any lucide `Ban`/circle-slash icon that appears on hover gets a visible text label next to it ("Not allowed") and an `aria-label`; no icon-only state.
- **Section descriptions**: Add short (1–2 sentence) helper text under each step heading — Step 1 (Application form: what it is, which basic fields it fills), Step 2 (Income document: why one is required, what types count), "Added so far" (what deleting does).

## Review page
- Add short helper text under the page heading and under each of the two section headings ("Basic values", "Values used for calculation", "Safety check") describing what the user is doing in that section and how confirmation works.
- **Save confirmation feedback for same-source values**: In `SameSourceEditor` (`src/routes/review.tsx` around line 539–630), after `save()` succeeds:
  - Set a local `justSaved` boolean (auto-clear after ~3s).
  - Show an inline confirmation row directly under the Save button: check-mark icon **plus the text "Saved."** and a timestamp ("Saved just now"). Not color-only.
  - Also announce via `LiveRegion` ("Same income source values saved.") — already partly wired; ensure it fires on every save, not only first.
- **Simplify "Why Counted Once"**: In `src/components/income-source-timeline.tsx`, collapse the per-source detail list behind a "Show sources" expandable (`<details>` or a controlled disclosure with a text-labeled toggle button "Show sources" / "Hide sources"). The default view shows only: the one-line explanation and the final counted amount. No overwhelming source-by-source dump until expanded.

## Calculation / final verdict
- Remove the pass/warn/fail color system for the final comparison verdict. Render the comparison line ("Annualized income is below/at/above threshold") in a single neutral style — brand blue background/border, no green/red/amber, no check-mark, no ✕ icon. Just text.
- Apply the same change to the PDF eligibility summary block in `src/routes/packet.tsx`: strip status color tokens and the check/cross glyph; use a single neutral rule and black text for the comparison line. (PDF is already black-and-white — just remove any remaining status indicator.)

## Packet page
- **Remove "Delete my packet" button** (`src/routes/packet.tsx` ~line 1442).
- **Add "Done — delete session and all associated information" button** at the bottom of the page. It calls the existing session-delete action (same one used by the header trash button) and, after clearing, routes to `/` with a `LiveRegion` announcement ("Session and all information deleted."). Full-width, primary style, with explicit text (no icon-only).
- Add a short description above the new button explaining exactly what it clears (uploads, extracted values, edits, packet) and that it is irreversible.

## Descriptions across steps
Add concise (≤2 sentences) descriptions under the main heading of each route: Home, Upload, Review, Confirm, Calculation, Packet. Goal: tell the user what this step is, what they'll do, and what happens next — without walls of text.

## Files touched
- `src/routes/upload.tsx` — remove finish button, require application form, add descriptions, add explicit "Not allowed" text, label ban icon.
- `src/routes/review.tsx` — save-confirmation UI, section descriptions.
- `src/components/income-source-timeline.tsx` — collapse sources behind "Show sources" toggle, simpler default copy.
- `src/routes/calculation.tsx` — neutral single-color verdict, no status icon.
- `src/routes/packet.tsx` — remove "Delete my packet", add "Done — delete session…" button, neutralize PDF verdict styling.
- `src/routes/index.tsx`, `src/routes/confirm.tsx`, `src/components/page-shell.tsx`, etc. — rename + step descriptions.
- Rename SimplePath everywhere listed above.

No backend, no session-store schema, no calculation logic changes.
