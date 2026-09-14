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
});

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getLocationId(extras: Record<string, unknown>): string {
  return text(extras.locationId);
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof GhlSmsActionError) {
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
      message: "extras.locationId is required.",
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
    const parsed = actionEnvelopeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        code: "INVALID_ACTION_PAYLOAD",
        message: parsed.error.issues[0]?.message ?? "Invalid action payload.",
      });
      return;
    }

    const locationId = getLocationId(parsed.data.extras);
    if (!(await requireLocation(locationId, res))) return;

    try {
      const options = await getSmsCustomValueOptions(locationId);
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
    const parsed = actionEnvelopeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        code: "INVALID_ACTION_PAYLOAD",
        message: parsed.error.issues[0]?.message ?? "Invalid action payload.",
      });
      return;
    }

    const locationId = getLocationId(parsed.data.extras);
    if (!(await requireLocation(locationId, res))) return;

    try {
      const input = parseSmsActionInput(parsed.data.data);
      const result = await sendSavedSms(
        locationId,
        input,
        text(parsed.data.extras.contactId)
      );
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
}
