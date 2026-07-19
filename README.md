# SimplePath

SimplePath is a document review and income-calculation assistant for affordable housing application packets. It helps a reviewer turn uploaded application documents into structured fields, source-backed calculations, and a compact reviewer handoff without making approval or denial decisions.

The app is built for busy reviewers and applicants who may not be comfortable reading dense English paperwork. It uses plain language, highlights where each value came from, flags uncertain issues, and keeps the final output limited to factual comparison and human-review support.

## What It Does

- Uploads synthetic application PDFs, pay stubs, employment letters, benefit letters, and gig statements.
- Extracts structured fields with page-level source highlights.
- Uses `pdfplumber` for PDF text extraction, rendered page previews, and OCR fallback for rasterized documents.
- Detects possible duplicate income documents before final calculation.
- Prevents overcounting repeated pay stubs or matching employment letters unless the user chooses to count them separately.
- Calculates annualized income only from confirmed fields and reviewer choices.
- Compares income to the relevant HUD MTSP threshold as a factual comparison only.
- Generates a reviewer packet with citations, warnings, duplicate-income decisions, and a reviewer handoff.
- Provides a guarded chat helper that can answer based only on uploaded/extracted app information and trusted rule references.

## Safety Boundaries

SimplePath does not approve, deny, rank, score, or recommend applicants.

The app is designed to:

- Avoid inferring protected traits.
- Avoid using demographic, behavioral, or landlord-revenue features.
- Treat uploaded document text as untrusted input.
- Flag suspicious prompt-injection text instead of following it.
- Require the user to resolve duplicate-income reviews before threshold comparison.
- Keep AI advisory only; AI cannot change values or make final counting decisions.

## Duplicate Income Review

The app groups income documents that appear to describe the same source, such as two pay stubs from the same job plus a matching employment letter.

For example, if three documents all describe Mara North at Harbor Kite Market earning `$28.50/hour` for `38 hours/week`, the app asks whether to:

- Count them once as the same job/source.
- Count them separately as different jobs/sources.
- Flag the group for human review.

If counted once, the annualized income is:

```text
$28.50 x 38 x 52 = $56,316/year
```

instead of incorrectly adding the same income three times.

## Tech Stack

- React
- TanStack Router / TanStack Start
- TypeScript
- Vite
- Python document extraction script
- `pdfplumber` for PDF text extraction
- OCR fallback through rendered PDF pages and Tesseract
- OpenAI-powered guarded chat workflow
- Tavily allowlisted retrieval for HUD reference lookup, with local fallback evidence
- JSON and PDF packet generation

## Project Structure

```text
lovable-app/
  src/
    components/       Reusable UI components
    lib/              Session state, calculations, validation, chat guardrails
    routes/           Upload, review, calculation, packet, and API routes
  scripts/
    document_extractor.py
    *.test.mjs
  public/
  package.json
```

The synthetic data and gold files live one directory above this app:

```text
../synthetic_documents/documents/
../synthetic_documents/gold/document_gold.jsonl
```

## Setup

Install dependencies:

```bash
npm install
```

Run the local app:

```bash
npm run dev
```

Then open the local URL shown in the terminal.

## Testing

Run the app test suite:

```bash
npm run test
```

Run evidence, citation, duplicate-income, chat, and validation tests:

```bash
npm run test:evidence
```

Build for production:

```bash
npm run build
```

Current verified results:

- Synthetic PDFs: `24/24` passed
- Document type detection: `24/24` passed
- Gold field extraction: `24/24` passed
- PDF previews: `24/24` passed
- Suspicious text detection: `24/24` passed
- App evidence/calculation tests: `35/35` passed
- Production build: passed

## Gold Household Results

Expected totals from the synthetic gold data:

```text
HH-001: $56,316.00
HH-002: $49,920.00
HH-003: $40,230.00
HH-004: $49,568.00
HH-005: $45,968.00
HH-006: $105,000.00
```

All are factual threshold comparisons only, not eligibility decisions.

## Environment Notes

For full PDF extraction and preview support, the local server must be running. Uploads created while the server extractor is unavailable may show demo fallback values and will need to be re-uploaded after the server is running.

Optional environment variables:

```bash
OPENAI_API_KEY=...
TAVILY_API_KEY=...
EXTRACTOR_SERVICE_URL=https://your-extractor-service.onrender.com
RENTSMOOTH_PYTHON_BIN=/path/to/python3
```

Do not commit API keys to GitHub. For local testing, put them in your local environment or an uncommitted `.env` file. For deployment, add them as private environment variables/secrets in the hosting provider.

If live HUD retrieval is unavailable, the app uses a frozen local HUD reference and labels it as fallback evidence.

For Vercel PDF extraction, deploy the Docker service in `extractor-service/` to Render or Railway, then set `EXTRACTOR_SERVICE_URL` in Vercel. Local development can still use the direct Python extractor.

## License and Data

This project uses only synthetic applicant documents from the RealDoor hackathon starter pack. No real applicant data is included.

See the starter pack governance and license files for dataset and challenge-use constraints.

No API keys, private documents, or applicant data should be committed to this repository.
