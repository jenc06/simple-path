import { createFileRoute } from "@tanstack/react-router";
import { scanAndExtractUploadedDocument } from "@/lib/server-document-extraction";
import type { DocType } from "@/lib/session-store";

const DOC_TYPES = new Set<DocType>([
  "application_form",
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
]);

export const Route = createFileRoute("/api/scan-and-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const selectedDocType = form.get("selectedDocType");
        const docId = form.get("docId");
        if (!(file instanceof File)) {
          return Response.json({ error: "Missing upload file." }, { status: 400 });
        }
        if (typeof selectedDocType !== "string" || !DOC_TYPES.has(selectedDocType as DocType)) {
          return Response.json({ error: "Unsupported selected document type." }, { status: 400 });
        }
        if (typeof docId !== "string" || !docId) {
          return Response.json({ error: "Missing document id." }, { status: 400 });
        }

        try {
          const result = await scanAndExtractUploadedDocument(
            file,
            selectedDocType as DocType,
            docId,
          );
          return Response.json(result);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Could not process uploaded document.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
