// Local test server for the n8n proxy endpoints.
// Mocks the GHL service layer so the full HTTP/auth/signature flow can be
// exercised with `curl` / test-n8n-backend.sh, with no database needed.
//
// Usage: INTERNAL_API_KEY=secret PORT=4501 npx tsx local-n8n-server.ts
// Then run from the deliverables dir:
//   INTERNAL_API_KEY=secret BACKEND_URL=http://127.0.0.1:4501 ../deliverables/test-n8n-backend.sh

import { register } from "node:module";

// ── Register a mock loader for server/ghl-service ───────────────────
// node:module's register resolves relative specifiers against import.meta.url automatically.
register("./mock-ghl-service-loader.ts", import.meta.url);

const express = (await import("express")).default;
const { registerN8nRoutes } = await import("./server/routes/n8n");

const app = express();
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString("utf8");
    },
  }),
);
registerN8nRoutes(app);

const PORT = Number(process.env.PORT ?? 4501);
app.listen(PORT, () => {
  console.log(`Local n8n proxy test server on http://127.0.0.1:${PORT}`);
  console.log("  INTERNAL_API_KEY =", process.env.INTERNAL_API_KEY ?? "(not set!)");
});
