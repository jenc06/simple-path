import { createFileRoute } from "@tanstack/react-router";
import { extractUploadedDocument } from "@/lib/server-document-extraction";
import type { DocType } from "@/lib/session-store";
import type { ScanResult } from "@/lib/extraction-backend";

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
        const scanRaw = form.get("scan");

        if (!(file instanceof File)) {
          return Response.json({ error: "Missing uploaded file." }, { status: 400 });
        }
        if (
          typeof finalDocType !== "string" ||
          !DOC_TYPES.has(finalDocType as DocType)
        ) {
          return Response.json({ error: "Unsupported document type." }, { status: 400 });
        }
        if (typeof docId !== "string" || docId.length === 0) {
          return Response.json({ error: "Missing document id." }, { status: 400 });
        }
        if (typeof scanRaw !== "string") {
          return Response.json({ error: "Missing scan result." }, { status: 400 });
        }

        let scan: ScanResult;
        try {
          scan = JSON.parse(scanRaw) as ScanResult;
        } catch {
          return Response.json({ error: "Invalid scan result." }, { status: 400 });
        }

        const result = await extractUploadedDocument({
          finalDocType: finalDocType as DocType,
          docId,
          file,
          scan,
        });

        return Response.json(result);
      },
    },
  },
});
