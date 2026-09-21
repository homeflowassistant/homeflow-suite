import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  GhlSmsActionError,
  getSmsCustomValueOptions,
  parseSmsActionInput,
  sendSavedSms,
} from "../services/ghl-sms-custom-action-service.js";
import { getInstallation } from "../ghl-service.js";

const actionEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional().default({}),
  extras: z.record(z.string(), z.unknown()).optional().default({}),
  meta: z.record(z.string(), z.unknown()).optional().default({}),
  locationId: z.unknown().optional(),
  location_id: z.unknown().optional(),
  locationID: z.unknown().optional(),
  location: z.unknown().optional(),
}).passthrough();

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function redactId(value: string): string {
  return value.length > 6 ? `…${value.slice(-6)}` : value ? "[set]" : "[missing]";
}

function logIncomingRequest(req: Request, body: unknown): void {
  const payload = body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
  const data = payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};
  const extras = payload.extras && typeof payload.extras === "object"
    ? (payload.extras as Record<string, unknown>)
    : {};

  console.log("[GHL SMS Action][INCOMING]", {
    method: req.method,
    path: req.path,
    bodyKeys: Object.keys(payload),
    dataKeys: Object.keys(data),
    extrasKeys: Object.keys(extras),
    contentType: req.headers["content-type"] ?? "unknown",
  });
}

function getLocationId(
  req: Request,
  payload: {
    data: Record<string, unknown>;
    extras: Record<string, unknown>;
    locationId?: unknown;
    location_id?: unknown;
    locationID?: unknown;
    location?: unknown;
  }
): string {
  const nestedLocation =
    payload.location && typeof payload.location === "object"
      ? (payload.location as Record<string, unknown>)
      : {};
  return (
    text(payload.extras.locationId) ||
    text(payload.extras.location_id) ||
    text(payload.locationId) ||
    text(payload.location_id) ||
    text(payload.locationID) ||
    text(nestedLocation.locationId) ||
    text(nestedLocation.id) ||
    text(payload.data.locationId) ||
    text(payload.data.location_id) ||
    text(payload.data.locationID) ||
    text(req.query.locationId) ||
    text(req.query.location_id) ||
    text(req.headers["x-location-id"]) ||
    text(req.headers["location-id"])
  );
}

function getActionData(payload: Record<string, unknown>): Record<string, unknown> {
  const envelopeKeys = new Set([
    "data",
    "extras",
    "meta",
    "locationId",
    "location_id",
    "locationID",
    "location",
  ]);
  const topLevelFields = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !envelopeKeys.has(key))
  );
  const nestedData =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  return { ...topLevelFields, ...nestedData };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof GhlSmsActionError) {
    console.warn("[GHL SMS Action][FAILED]", {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    });
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }

  console.error("[GHL SMS Action] request failed", error);
  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Unable to process the HomeFlow SMS action.",
  });
}

async function requireLocation(locationId: string, res: Response): Promise<boolean> {
  if (!locationId) {
    res.status(400).json({
      success: false,
      code: "LOCATION_ID_REQUIRED",
      message: "A HighLevel location ID is required.",
    });
    return false;
  }

  try {
    if (!(await getInstallation(locationId))) {
      res.status(403).json({
        success: false,
        code: "LOCATION_NOT_INSTALLED",
        message: "HomeFlow is not installed for this HighLevel location.",
      });
      return false;
    }
  } catch (error) {
    console.error("[GHL SMS Action] installation check failed", error);
    res.status(503).json({
      success: false,
      code: "INSTALLATION_LOOKUP_FAILED",
      message: "Unable to verify the installed HighLevel location.",
    });
    return false;
  }

  return true;
}

export function registerGhlSmsCustomActionRoutes(app: Express): void {
  app.post("/api/ghl/custom-action/sms-fields", async (req: Request, res: Response) => {
    logIncomingRequest(req, req.body);
    const parsed = actionEnvelopeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        code: "INVALID_ACTION_PAYLOAD",
        message: parsed.error.issues[0]?.message ?? "Invalid action payload.",
      });
      return;
    }

    const locationId = getLocationId(req, parsed.data);
    console.log("[GHL SMS Action][FIELDS]", {
      locationId: redactId(locationId),
    });
    if (!(await requireLocation(locationId, res))) return;

    try {
      const options = await getSmsCustomValueOptions(locationId);
      console.log("[GHL SMS Action][FIELDS_SUCCESS]", {
        locationId: redactId(locationId),
        optionCount: options.length,
      });
      res.status(200).json({
        inputs: [
          {
            section: "HomeFlow SMS",
            fields: [
              {
                field: "messageCustomValueKey",
                title: "Saved SMS message",
                fieldType: "select",
                required: true,
                options,
              },
              {
                field: "contactId",
                title: "Contact ID",
                fieldType: "string",
                required: false,
              },
              {
                field: "contactPhone",
                title: "Contact Phone",
                fieldType: "string",
                required: false,
              },
              {
                field: "contactEmail",
                title: "Contact Email",
                fieldType: "string",
                required: false,
              },
              {
                field: "fromNumber",
                title: "From Number",
                fieldType: "string",
                required: false,
              },
            ],
          },
        ],
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/ghl/custom-action/send-sms", async (req: Request, res: Response) => {
    logIncomingRequest(req, req.body);
    const parsed = actionEnvelopeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        code: "INVALID_ACTION_PAYLOAD",
        message: parsed.error.issues[0]?.message ?? "Invalid action payload.",
      });
      return;
    }

    const locationId = getLocationId(req, parsed.data);
    if (!(await requireLocation(locationId, res))) return;

    try {
      const actionData = getActionData(parsed.data);
      const input = parseSmsActionInput(actionData);
      const resolvedContactId =
        text(parsed.data.extras.contactId) || text(actionData.contactId);
      console.log("[GHL SMS Action][SEND_START]", {
        locationId: redactId(locationId),
        customValueKey: input.messageCustomValueKey,
        contactId: redactId(resolvedContactId),
        contactPhoneProvided: Boolean(input.contactPhone),
        contactEmailProvided: Boolean(input.contactEmail),
      });
      const result = await sendSavedSms(
        locationId,
        input,
        resolvedContactId
      );
      console.log("[GHL SMS Action][SEND_SUCCESS]", {
        locationId: redactId(locationId),
        contactId: redactId(result.contactId),
        conversationId: redactId(result.conversationId ?? ""),
        messageId: redactId(result.messageId ?? ""),
      });
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
}
