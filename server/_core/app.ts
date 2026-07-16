import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Express } from "express";
import { registerOAuthRoutes } from "./oauth";
import { registerGHLOAuthRoutes } from "../ghl-oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./vite";

export function createApp(options?: { serveClient?: boolean }): Express {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // CORS configuration: allow explicit origins and enable credentials
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    console.warn("[CORS] No ALLOWED_ORIGINS configured; allowing all origins (development only)");
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

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (options?.serveClient) {
    serveStatic(app);
  }

  return app;
}
