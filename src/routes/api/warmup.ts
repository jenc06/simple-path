import { createFileRoute } from "@tanstack/react-router";

const EXTRACTOR_SERVICE_URL = process.env.EXTRACTOR_SERVICE_URL?.replace(/\/+$/, "");

export const Route = createFileRoute("/api/warmup")({
  server: {
    handlers: {
      GET: async () => {
        if (!EXTRACTOR_SERVICE_URL) {
          return Response.json({ ok: true, skipped: true });
        }
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30_000);
          await fetch(`${EXTRACTOR_SERVICE_URL}/health`, { signal: controller.signal });
          clearTimeout(timeout);
        } catch {
          // Ignore errors — warmup is best-effort
        }
        return Response.json({ ok: true });
      },
    },
  },
});
