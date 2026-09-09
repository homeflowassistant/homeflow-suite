import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ENV } from "../_core/env.js";
import { getInstallation } from "../ghl-service.js";
import {
  CustomTriggerHttpError,
  deliverCustomTriggerPayloadForLocation,
} from "../services/custom-trigger-service.js";

const locationIdSchema = z
  .string()
  .trim()
  .min(1, "locationId is required.")
  .max(128, "locationId is too long.");

const payloadSchema = z
  .record(z.string(), z.unknown())
  .refine(
    value => Object.keys(value).length > 0,
    "Request body must be a non-empty JSON object."
  );

function getLocationId(req: Request): string | undefined {
  // HTTP header names are case-insensitive. Express's req.get() handles the
  // user's preferred `locationId` spelling while also supporting a conventional
  // prefixed alias for clients that disallow non-standard unprefixed headers.
  return (
    req.get("locationId")?.trim() ||
    req.get("x-location-id")?.trim() ||
    undefined
  );
}

function isAuthorized(req: Request): boolean {
  const configuredKey = ENV.internalApiKey.trim();
  if (!configuredKey) return false;
  return req.get("authorization") === `Internal-Key ${configuredKey}`;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof CustomTriggerHttpError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }

  console.error("[n8n custom trigger] route failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Unable to process the custom-trigger request.",
  });
}

/**
 * Machine-to-machine endpoint for n8n.
 *
 * The location is intentionally accepted only from a header. The JSON body is
 * treated as event data and is never allowed to select the HighLevel account.
 */
export function registerN8nCustomTriggerRoutes(app: Express): void {
  app.post("/api/n8n/custom-trigger", async (req: Request, res: Response) => {
    if (!ENV.internalApiKey.trim()) {
      res.status(503).json({
        success: false,
        code: "INTERNAL_AUTH_NOT_CONFIGURED",
        message:
          "The n8n endpoint is not configured for machine-to-machine authentication.",
      });
      return;
    }

    if (!ENV.n8nCustomTriggerKey.trim()) {
      res.status(503).json({
        success: false,
        code: "N8N_TRIGGER_KEY_NOT_CONFIGURED",
        message:
          "The separate HighLevel custom trigger key for n8n is not configured.",
      });
      return;
    }

    if (!isAuthorized(req)) {
      res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Invalid or missing Internal-Key authorization.",
      });
      return;
    }

    const parsedLocationId = locationIdSchema.safeParse(getLocationId(req));
    if (!parsedLocationId.success) {
      res.status(400).json({
        success: false,
        code: "LOCATION_ID_REQUIRED",
        message:
          parsedLocationId.error.issues[0]?.message ||
          "locationId is required.",
      });
      return;
    }

    const parsedPayload = payloadSchema.safeParse(req.body);
    if (!parsedPayload.success) {
      res.status(400).json({
        success: false,
        code: "INVALID_PAYLOAD",
        message:
          parsedPayload.error.issues[0]?.message ||
          "Request body must be a non-empty JSON object.",
      });
      return;
    }

    const locationId = parsedLocationId.data;
    try {
      // Exact installation lookup is performed before delivery. This prevents
      // a valid internal caller from using an arbitrary location identifier.
      const installation = await getInstallation(locationId);
      if (!installation) {
        res.status(403).json({
          success: false,
          code: "LOCATION_NOT_INSTALLED",
          message: "The HomeFlow app is not installed for this location.",
          locationId,
        });
        return;
      }

      const result = await deliverCustomTriggerPayloadForLocation(
        locationId,
        parsedPayload.data,
        undefined,
        { triggerKey: ENV.n8nCustomTriggerKey.trim() }
      );

      if (result.failed > 0) {
        res.status(502).json({
          success: false,
          code: "PARTIAL_DELIVERY_FAILURE",
          ...result,
          message:
            "The payload was received, but one or more HighLevel workflow deliveries failed.",
        });
        return;
      }

      res.status(202).json({
        success: true,
        code: "DELIVERED",
        ...result,
      });
    } catch (error) {
      sendError(res, error);
    }
  });
}
