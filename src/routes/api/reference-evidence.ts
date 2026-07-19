import { createFileRoute } from "@tanstack/react-router";
import { getReferenceEvidence } from "@/lib/reference-evidence.server";

export const Route = createFileRoute("/api/reference-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const householdSizeRaw = url.searchParams.get("householdSize") ?? "1";
        const householdSize = Number(householdSizeRaw);
        if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 8) {
          return Response.json({ error: "Unsupported household size." }, { status: 400 });
        }

        const evidence = await getReferenceEvidence(householdSize);
        return Response.json(evidence);
      },
    },
  },
});
