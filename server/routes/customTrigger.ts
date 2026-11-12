import { timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { requireLocationSession } from "./auth.js";
import { z } from "zod";
import { ENV } from "../_core/env.js";

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
import { getInstallation } from "../ghl-service.js";
import {
  CustomTriggerHttpError,
  deliverCustomTriggerPayloadForLocation,
  ensureCustomTriggerWebhook,
  resolveCustomTriggerWebhook,
  getCustomTriggerWebhookForLocation,
  recordCustomTriggerSubscription,
  rotateCustomTriggerWebhook,
  serializeBinding,
  type CustomTriggerSubscriptionPayload,
} from "../services/custom-trigger-service.js";
import { chooseForwardTarget, redactSecrets, relayToN8n } from "../services/n8n-relay-service.js";

const subscriptionSchema = z.object({
  triggerData: z
    .object({
      id: z.unknown().optional(),
      key: z.unknown().optional(),
      filters: z.unknown().optional(),
      eventType: z.unknown().optional(),
      targetUrl: z.unknown().optional(),
    })
    .optional(),
  meta: z
    .object({ key: z.unknown().optional(), version: z.unknown().optional() })
    .optional(),
  extras: z
    .object({
      locationId: z.unknown().optional(),
      workflowId: z.unknown().optional(),
      companyId: z.unknown().optional(),
    })
    .optional(),
});

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getLocationId(req: Request): string | undefined {
  const value = req.query.locationId || req.query.location_id;
  return normalizeText(Array.isArray(value) ? value[0] : value);
}

function getSubscriptionSecret(req: Request): string | undefined {
  const header = req.headers["x-homeflow-subscription-secret"];
  return normalizeText(Array.isArray(header) ? header[0] : header);
}

function isSubscriptionAuthorized(req: Request): boolean {
  const configuredSecret = ENV.customTriggerSubscriptionSecret.trim();
  if (!configuredSecret) {
    console.warn("[Custom Trigger] CUSTOM_TRIGGER_SUBSCRIPTION_SECRET is not configured; accepting unsigned subscription callbacks");
    return true;
  }
  return safeEqual(getSubscriptionSecret(req) ?? "", configuredSecret);
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof CustomTriggerHttpError) {
    res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return;
  }
  console.error("[Custom Trigger] route failed", error);
  res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Unable to process the custom-trigger request." });
}

function logIncomingCustomTriggerPayload(req: Request): void {
  console.log("[Custom Trigger][PAYLOAD_RECEIVED]", {
    receivedAt: new Date().toISOString(),
    contentType: req.headers["content-type"] ?? "unknown",
    contentLength: req.headers["content-length"] ?? "unknown",
    payload: redactSecrets(req.body ?? {}),
  });
}

async function requireInstalledLocation(locationId: string, res: Response): Promise<boolean> {
  if (!ENV.databaseUrl.trim()) {
    res.status(503).json({ success: false, code: "DATABASE_NOT_CONFIGURED", message: "The HomeFlow database is not configured." });
    return false;
  }
  try {
    const installation = await getInstallation(locationId);
    if (!installation) {
      res.status(403).json({ success: false, code: "LOCATION_NOT_INSTALLED", message: "The HomeFlow app is not installed for this location." });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Custom Trigger] installation lookup failed", { locationId, error: error instanceof Error ? error.message : String(error) });
    res.status(503).json({ success: false, code: "INSTALLATION_LOOKUP_FAILED", message: "Unable to verify the installed location." });
    return false;
  }
}

export function registerCustomTriggerRoutes(app: Express): void {
  /**
   * HighLevel calls this endpoint when a Marketplace custom trigger instance
   * is CREATED, UPDATED, or DELETED in a workflow. The targetUrl in the
   * callback is the HighLevel execution URL for that destination workflow.
   */
  app.post("/api/ghl/custom-trigger/subscription", async (req: Request, res: Response) => {
    if (!isSubscriptionAuthorized(req)) {
      res.status(401).json({ success: false, code: "INVALID_SUBSCRIPTION_SECRET", message: "Invalid subscription callback secret." });
      return;
    }

    const parsed = subscriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, code: "INVALID_SUBSCRIPTION_PAYLOAD", message: parsed.error.issues[0]?.message || "Invalid subscription payload." });
      return;
    }

    try {
      const result = await recordCustomTriggerSubscription(parsed.data as CustomTriggerSubscriptionPayload);
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * Returns one stable HomeFlow webhook URL for the currently installed
   * location. Calling this endpoint also provisions the URL on first access.
   */
  app.get("/api/custom-trigger/webhook", async (req: Request, res: Response) => {
    const locationId = getLocationId(req);
    if (!locationId) {
      res.status(400).json({ success: false, code: "LOCATION_ID_REQUIRED", message: "locationId is required." });
      return;
    }
    if (!(await requireLocationSession(req, res, locationId))) return;
    if (!(await requireInstalledLocation(locationId, res))) return;

    try {
      const data = await getCustomTriggerWebhookForLocation(locationId);
      res.json({
        success: true,
        ...data,
        bindings: data.bindings.map(binding => serializeBinding(binding as never)),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * Optional recovery operation for a leaked URL. Existing callers receive
   * 404 after rotation because the previous token no longer resolves.
   */
  app.post("/api/custom-trigger/webhook/rotate", async (req: Request, res: Response) => {
    const locationId = normalizeText(req.body?.locationId);
    if (!locationId) {
      res.status(400).json({ success: false, code: "LOCATION_ID_REQUIRED", message: "locationId is required." });
      return;
    }
    if (!(await requireLocationSession(req, res, locationId))) return;
    if (!(await requireInstalledLocation(locationId, res))) return;

    try {
      const data = await rotateCustomTriggerWebhook(locationId);
      res.json({ success: true, ...data, message: "Custom-trigger webhook URL rotated. Update the external sender before using the new URL." });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * Public endpoint used by n8n or another external sender. The URL token is
   * the credential; no user session or Authorization header is required.
   */
  app.post("/webhooks/:token", async (req: Request, res: Response) => {
    try {
      logIncomingCustomTriggerPayload(req);
      const body = req.body ?? {};
      const webhook = await resolveCustomTriggerWebhook(req.params.token);

      // GHL workflow Webhook actions (e.g. "Webhook - Create Quote") go to n8n.
      if (chooseForwardTarget(body, webhook.locationId, req.query.forward) === "n8n") {
        const relay = await relayToN8n(webhook.locationId, webhook.companyId, body);
        if (!relay.ok) {
          res.status(502).json({ success: false, code: "N8N_RELAY_FAILED", locationId: relay.locationId, n8nStatus: relay.status, n8nReply: relay.reply, message: "The payload was received, but n8n did not accept it." });
          return;
        }
        res.status(202).json({ success: true, code: "FORWARDED_TO_N8N", locationId: relay.locationId, n8nStatus: relay.status });
        return;
      }

      // Everything else (n8n, Sweep & Go, Zapier) starts GHL custom-trigger workflows.
      const result = await deliverCustomTriggerPayloadForLocation(
        webhook.locationId,
        body,
        webhook.id,
        { excludeTriggerKey: ENV.n8nCustomTriggerKey }
      );
      if (result.failed > 0) {
        res.status(502).json({ success: false, code: "PARTIAL_DELIVERY_FAILURE", ...result, message: "The payload was received, but one or more HighLevel workflow deliveries failed." });
        return;
      }
      res.status(202).json({ success: true, code: "DELIVERED", ...result });
    } catch (error) {
      sendError(res, error);
    }
  });
}
