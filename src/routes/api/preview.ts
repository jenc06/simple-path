import { createFileRoute } from "@tanstack/react-router";
import { fetchDocumentPreview } from "@/lib/server-document-extraction";

export const Route = createFileRoute("/api/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        const pages = form.get("pages");
        if (!(file instanceof File)) {
          return Response.json({ error: "Missing upload file." }, { status: 400 });
        }
        let pageNumbers: number[] = [];
        try {
          pageNumbers = JSON.parse(typeof pages === "string" ? pages : "[]");
        } catch {
          return Response.json({ error: "Invalid pages format." }, { status: 400 });
        }
        try {
          const previewPages = await fetchDocumentPreview(file, pageNumbers);
          return Response.json({ previewPages });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Could not generate preview." },
            { status: 500 },
          );
        }
      },
    },
  },
});
