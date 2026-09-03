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
import { registerRequestSchedulingUploadRoutes } from "../routes/requestSchedulingUpload.js";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";

export async function createApp(options?: { serveClient?: boolean }): Promise<Express> {
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

  registerOAuthRoutes(app);
  registerGHLOAuthRoutes(app);
  registerContactsCustomFieldRoutes(app);
  registerCustomValuesRoutes(app);
  registerCustomTriggerRoutes(app);
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

  return app;
}
