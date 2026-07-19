import { createFileRoute } from "@tanstack/react-router";
import { scanUploadedDocument } from "@/lib/server-document-extraction";
import type { DocType } from "@/lib/session-store";

const DOC_TYPES = new Set<DocType>([
  "application_form",
  "pay_stub",
  "benefit_letter",
  "employment_letter",
  "gig_statement",
]);

export const Route = createFileRoute("/api/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const selectedDocType = form.get("selectedDocType");

        if (!(file instanceof File)) {
          return Response.json({ error: "Missing uploaded file." }, { status: 400 });
        }
        if (
          typeof selectedDocType !== "string" ||
          !DOC_TYPES.has(selectedDocType as DocType)
        ) {
          return Response.json({ error: "Unsupported document type." }, { status: 400 });
        }

        const result = await scanUploadedDocument(file, selectedDocType as DocType);
        return Response.json(result);
      },
    },
  },
});
