import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Express } from "express";
import { registerOAuthRoutes } from "./oauth.js";
import { registerGHLOAuthRoutes } from "../ghl-oauth.js";
import { registerContactsCustomFieldRoutes } from "../routes/contactsCustomField.js";
import { registerZapierRoutes } from "../routes/zapier.js";
import { registerCustomValuesRoutes } from "../routes/customValues.js";
import { registerCustomTriggerRoutes } from "../routes/customTrigger.js";
import { registerN8nCustomTriggerRoutes } from "../routes/n8nCustomTrigger.js";
import { registerGhlSmsCustomActionRoutes } from "../routes/ghlSmsCustomAction.js";
import { registerRequestSchedulingUploadRoutes } from "../routes/requestSchedulingUpload.js";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { warnIfAuthDisabled } from "./ghlSso.js";

let safetyNetInstalled = false;
/**
 * Express 4 does not catch rejected promises from async handlers. Without
 * this, one failing request (e.g. an unknown locationId) terminated the
 * whole Node process. Log instead of crashing.
 */
function installProcessSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;
  process.on("unhandledRejection", reason => {
    console.error("[Process] Unhandled promise rejection (request failed, server kept running)", reason);
  });
}

export async function createApp(options?: {
  serveClient?: boolean;
}): Promise<Express> {
  const app = express();

  // Capture the raw request body while parsing JSON. The internal-machine
  // endpoints (e.g. server/routes/contactsCustomField.ts) verify an
  // HMAC-SHA256 signature over the exact raw bytes, so the unmodified body
  // is preserved on req.rawBody.
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString("utf8");
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // CORS configuration: allow explicit origins and enable credentials
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    console.warn(
      "[CORS] No ALLOWED_ORIGINS configured; allowing all origins (development only)"
    );
    app.use(
      cors({
        origin: true,
        credentials: true,
      })
    );
  } else {
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) return callback(null, false);
          if (allowedOrigins.includes(origin)) return callback(null, true);
          return callback(new Error("CORS origin not allowed"));
        },
        credentials: true,
      })
    );
  }

  registerAuthRoutes(app);
  warnIfAuthDisabled();
  registerOAuthRoutes(app);
  registerGHLOAuthRoutes(app);
  registerContactsCustomFieldRoutes(app);
  registerCustomValuesRoutes(app);
  registerCustomTriggerRoutes(app);
  registerN8nCustomTriggerRoutes(app);
  registerGhlSmsCustomActionRoutes(app);
  registerRequestSchedulingUploadRoutes(app);
  registerZapierRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (options?.serveClient) {
    const { serveStatic } = await import("./vite.js");
    serveStatic(app);
  }

  // Last-resort JSON error handler so a thrown route error never leaks a
  // stack trace or leaves the request hanging.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) return next(error);
      const status =
        typeof (error as { status?: unknown })?.status === "number"
          ? ((error as { status: number }).status as number)
          : 500;
      if (status >= 500) console.error("[Express] Unhandled route error", error);
      res.status(status).json({
        success: false,
        code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message:
          status >= 500 ? "Unexpected server error." : "Invalid request.",
      });
    }
  );

  installProcessSafetyNet();
  return app;
}
