import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { getInstallation, upsertContactWithTag } from "../ghl-service";

function getHeaderValue(req: Request, headerName: string): string {
  const value = req.headers[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function registerZapierRoutes(app: Express): void {
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

      const result = await upsertContactWithTag(locationId, {
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
        contactId: result.contact?.id,
        isNew: result.new,
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