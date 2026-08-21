import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ENV } from "../_core/env";
import { getInstallation } from "../ghl-service";
import {
  createOrGetZapierConnection,
  normalizeZapierError,
  revokeZapierConnection,
  rotateZapierConnection,
  upsertZapierContact,
  validateZapierConnectionKey,
  ZapierHttpError,
} from "../services/zapier-service";

function getHeaderValue(req: Request, headerName: string): string {
  const value = req.headers[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Upsert payload mirrors the Add Contact page field mapping exactly:
 * firstName, lastName, email, phone, address1, city, state, postalCode
 * plus the custom fields number_of_dogs, last_time_yard_was_thoroughly_cleaned,
 * clean_up_frequency and the marketing_allowed consent flag.
 */
const upsertSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    numberOfDogs: z.string().optional(),
    lastTimeScooped: z.string().optional(),
    frequency: z.string().optional(),
    marketingAllowed: z.union([z.boolean(), z.string()]).optional(),
    dnd: z.union([z.boolean(), z.string()]).optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "At least one of email or phone is required.",
    path: ["email"],
  });

type RateBucket = { count: number; resetAt: number };
const RATE_BUCKETS = new Map<string, RateBucket>();

function applyRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);

  if (!bucket || now >= bucket.resetAt) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  RATE_BUCKETS.set(key, bucket);
  return true;
}

function sendZapierError(res: Response, error: unknown) {
  const normalized = normalizeZapierError(error);
  res.status(normalized.statusCode).json({
    success: false,
    message: normalized.message,
  });
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return undefined;
}

async function requireInstalledLocation(locationId: string, res: Response): Promise<boolean> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    res.status(403).json({
      success: false,
      message: "The HomeFlow app is not installed or active for this location.",
    });
    return false;
  }

  return true;
}

function getZapierConnectionKey(req: Request): string | undefined {
  const fromHeader = normalizeText(getHeaderValue(req, "x-zapier-connection-key"));
  if (fromHeader) return fromHeader;

  // Query params can be string | string[] | ParsedQs. Handle string arrays and single strings.
  const q = req.query?.connectionKey as unknown;
  if (Array.isArray(q)) {
    const first = normalizeText(q[0]);
    if (first) return first;
  } else if (typeof q === "string") {
    const qstr = normalizeText(q);
    if (qstr) return qstr;
  }

  const fromBody = normalizeText(req.body?.connectionKey);
  if (fromBody) return fromBody;

  return undefined;
}

async function handleZapierAuthTest(req: Request, res: Response): Promise<void> {
  const remote = normalizeText(req.ip) ?? "unknown-ip";
  if (!applyRateLimit(`auth:${remote}`, 30, 60_000)) {
    res.status(429).json({
      success: false,
      message: "Too many requests. Try again shortly.",
    });
    return;
  }

  const connectionKey = getZapierConnectionKey(req);
  if (!connectionKey) {
    res.status(401).json({
      success: false,
      message: "Missing Zapier connection key.",
    });
    return;
  }

  try {
    const account = await validateZapierConnectionKey(connectionKey);

    res.json({
      success: true,
      account: {
        locationId: account.locationId,
        locationName: account.locationName,
        companyId: account.companyId,
      },
      label: `${account.locationName} - ${account.locationId}`,
    });
  } catch (error) {
    if (error instanceof ZapierHttpError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }

    sendZapierError(res, error);
  }
}

export function registerZapierRoutes(app: Express): void {
  app.get("/api/zapier/connection", async (req: Request, res: Response) => {
    try {
      const locationId = normalizeText(req.query.locationId);
      if (!locationId) {
        return res.status(400).json({
          success: false,
          message: "locationId is required.",
        });
      }

      if (!(await requireInstalledLocation(locationId, res))) return;

      const data = await createOrGetZapierConnection(locationId);

      return res.json({
        success: true,
        locationId,
        locationName: locationId,
        zapierEnabled: true,
        connectionKey: data.connectionKey,
        connectionKeyPreview: data.connectionKeyPreview,
        zapierInviteUrl: ENV.zapierInviteUrl,
        createdAt: data.createdAt.toISOString(),
        lastUsedAt: data.lastUsedAt ? data.lastUsedAt.toISOString() : null,
      });
    } catch (error) {
      return sendZapierError(res, error);
    }
  });

  app.post("/api/zapier/connection/rotate", async (req: Request, res: Response) => {
    try {
      const locationId = normalizeText(req.body?.locationId);
      if (!locationId) {
        return res.status(400).json({
          success: false,
          message: "locationId is required.",
        });
      }

      if (!(await requireInstalledLocation(locationId, res))) return;

      const rotated = await rotateZapierConnection(locationId);
      return res.json({
        success: true,
        locationId,
        connectionKey: rotated.connectionKey,
        connectionKeyPreview: rotated.connectionKeyPreview,
        message: "Zapier connection key rotated successfully. Existing Zaps using the old key will stop working.",
      });
    } catch (error) {
      return sendZapierError(res, error);
    }
  });

  app.post("/api/zapier/connection/revoke", async (req: Request, res: Response) => {
    try {
      const locationId = normalizeText(req.body?.locationId);
      if (!locationId) {
        return res.status(400).json({
          success: false,
          message: "locationId is required.",
        });
      }

      if (!(await requireInstalledLocation(locationId, res))) return;

      await revokeZapierConnection(locationId);
      return res.json({
        success: true,
        locationId,
        zapierEnabled: false,
        message: "Zapier access has been revoked for this location.",
      });
    } catch (error) {
      return sendZapierError(res, error);
    }
  });

  app.get("/api/zapier/auth/test", async (req: Request, res: Response) => {
    await handleZapierAuthTest(req, res);
  });

  app.post("/api/zapier/auth/test", async (req: Request, res: Response) => {
    await handleZapierAuthTest(req, res);
  });

  app.post("/api/zapier/contacts/upsert", async (req: Request, res: Response) => {
    const remote = normalizeText(req.ip) ?? "unknown-ip";
    if (!applyRateLimit(`upsert:${remote}`, 60, 60_000)) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Try again shortly.",
      });
    }

    const connectionKey = getZapierConnectionKey(req);
    if (!connectionKey) {
      return res.status(401).json({
        success: false,
        message: "Missing Zapier connection key.",
      });
    }

    const parsed = upsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      });
    }

    const payload = parsed.data;

    try {
      const response = await upsertZapierContact(connectionKey, {
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        address1: payload.address1,
        city: payload.city,
        state: payload.state,
        postalCode: payload.postalCode,
        numberOfDogs: payload.numberOfDogs,
        lastTimeScooped: payload.lastTimeScooped,
        frequency: payload.frequency,
        marketingAllowed: normalizeBoolean(payload.marketingAllowed),
        dnd: normalizeBoolean(payload.dnd),
        source: payload.source,
        tags: payload.tags,
      });

      return res.json({
        success: true,
        contact: {
          id: response.result.contactId,
          locationId: response.locationId,
          firstName: payload.firstName ?? "",
          lastName: payload.lastName ?? "",
          email: payload.email ?? "",
          phone: payload.phone ?? "",
        },
        operation: "upserted",
        tagApplied: response.tagApplied,
      });
    } catch (error) {
      return sendZapierError(res, error);
    }
  });

  // Legacy endpoint retained for backwards compatibility with existing internal automations.
  app.post("/api/create-contact", async (req: Request, res: Response) => {
    try {
      if (!ENV.internalApiKey) {
        return res.status(500).json({ error: "INTERNAL_API_KEY is not configured" });
      }

      const apiKey = getHeaderValue(req, "x-api-key");
      if (apiKey !== ENV.internalApiKey) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const locationId = normalizeText(req.body?.locationId);
      if (!locationId) {
        return res.status(400).json({ error: "locationId is required" });
      }

      const installation = await getInstallation(locationId);
      if (!installation) {
        return res.status(404).json({ error: `No GHL token found for location ${locationId}` });
      }

      // HomeFlow intentionally reuses its existing contact creation pipeline
      // (processContact) here so Zapier-sourced legacy calls behave identically to
      // contacts created through the Add Contact page.
      const result = await upsertContactForInternalApi(locationId, {
        firstName: normalizeText(req.body?.firstName),
        lastName: normalizeText(req.body?.lastName),
        name: normalizeText(req.body?.name),
        email: normalizeText(req.body?.email),
        phone: normalizeText(req.body?.phone),
        tags: ["trigger-royal-review"],
        source: "zapier",
      });

      return res.status(200).json({
        success: true,
        contactId: result.contactId,
        isNew: result.isNew,
        contact: result.contact,
      });
    } catch (error) {
      const status = error instanceof Error && /Unauthorized/i.test(error.message) ? 401 : 500;
      console.error("[Zapier] Contact creation failed:", error);
      return res.status(status).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
}

async function upsertContactForInternalApi(
  locationId: string,
  input: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    source?: string;
  }
): Promise<{ contactId: string; isNew: boolean; contact: Record<string, unknown> }> {
  const { processContact } = await import("../ghl-service.js");

  let firstName = input.firstName;
  let lastName = input.lastName;
  if (!firstName && input.name) {
    const parts = input.name.trim().split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ") || "";
  }

  const contactData = {
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    email: input.email ?? "",
    phone: input.phone ?? "",
    tagName: (input.tags ?? [])[0],
  };

  const result = await processContact(locationId, contactData);
  return {
    contactId: result.contactId,
    isNew: true,
    contact: { id: result.contactId },
  };
}
