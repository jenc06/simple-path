import { createFileRoute } from "@tanstack/react-router";
import { extractUploadedDocument } from "@/lib/server-document-extraction";
import type { ScanResult } from "@/lib/extraction-backend";
import type { DocType } from "@/lib/session-store";

const DOC_TYPES = new Set<DocType>([
  "application_form",
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
]);

export const Route = createFileRoute("/api/extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const finalDocType = form.get("finalDocType");
        const docId = form.get("docId");
        const scanJson = form.get("scan");
        if (!(file instanceof File)) {
          return Response.json({ error: "Missing upload file." }, { status: 400 });
        }
        if (typeof finalDocType !== "string" || !DOC_TYPES.has(finalDocType as DocType)) {
          return Response.json({ error: "Unsupported final document type." }, { status: 400 });
        }
        if (typeof docId !== "string" || docId.length === 0) {
          return Response.json({ error: "Missing document id." }, { status: 400 });
        }
        if (typeof scanJson !== "string") {
          return Response.json({ error: "Missing scan result." }, { status: 400 });
        }

        let scan: ScanResult;
        try {
          scan = JSON.parse(scanJson) as ScanResult;
        } catch {
          return Response.json({ error: "Invalid scan result." }, { status: 400 });
        }

        try {
          const result = await extractUploadedDocument({
            file,
            finalDocType: finalDocType as DocType,
            docId,
            scan,
          });
          return Response.json(result);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Could not extract uploaded document.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
