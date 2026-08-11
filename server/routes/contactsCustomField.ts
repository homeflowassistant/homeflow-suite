/**
 * Contact Custom-Field Update API
 *
 * Machine-to-machine endpoint used by n8n workflows to update a single
 * custom-field value on a CRM contact WITHOUT any private integration key
 * reaching n8n.
 *
 * Flow: n8n HTTP Request -> POST /api/contacts/update-custom-field
 *       (authenticated via Internal-Key) -> this module -> GHL API (using the
 *       per-location OAuth token stored in the ghl_installations table,
 *       auto-refreshed by ghl-service)
 *
 * Security model:
 *  1. Authorization: `Authorization: Internal-Key <INTERNAL_API_KEY>`
 *  2. Location scoping: the locationId must exist in ghl_installations — one
 *     sub-account can never be reached through another location's token.
 *
 * All GHL operations reuse the existing primitives in server/ghl-service.ts
 * (getValidAccessToken, getCustomFieldIdByName, clearCustomFieldCache).
 */

import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import {
  getValidAccessToken,
  getInstallation,
  getCustomFieldIdByName,
  clearCustomFieldCache,
} from "../ghl-service";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

/**
 * Payload validation
 */
interface ValidatedPayload {
  locationId: string;
  email: string;
  customFieldName: string;
  value: string;
  contactName?: string;
}

function validatePayload(body: any): {
  payload: ValidatedPayload | null;
  errors: Array<{ field: string; message: string }>;
} {
  const errors: Array<{ field: string; message: string }> = [];

  if (!body.locationId || typeof body.locationId !== "string") {
    errors.push({ field: "locationId", message: "Required string" });
  }
  if (!body.email || typeof body.email !== "string" || !body.email.includes("@")) {
    errors.push({ field: "email", message: "Required valid email string" });
  }
  if (!body.customFieldName || typeof body.customFieldName !== "string") {
    errors.push({ field: "customFieldName", message: "Required string" });
  }
  if (body.value === undefined || body.value === null || body.value === "") {
    errors.push({ field: "value", message: "Required value (string, number, or boolean)" });
  }

  if (errors.length > 0) return { payload: null, errors };

  return {
    payload: {
      locationId: body.locationId,
      email: body.email,
      customFieldName: body.customFieldName,
      value: String(body.value),
      contactName: body.contactName ? String(body.contactName) : undefined,
    },
    errors: [],
  };
}

/**
 * Location resolution (Location Scoping)
 *
 * Verifies the locationId is installed in our app. Returns the internal
 * locationId on success, throws a 404-coded error on failure.
 */
async function resolveLocation(locationId: string): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw Object.assign(
      new Error(
        `No GHL installation found for locationId "${locationId}". ` +
          "The sub-account may not have the HomeFlow app installed."
      ),
      { code: "LOCATION_NOT_FOUND" }
    );
  }
  return installation.locationId;
}

/**
 * Contact custom field update logic
 *
 * Steps:
 *  1. Resolve the location via ghl_installations (location scoping).
 *  2. Look up the custom field ID for customFieldName (with cache refresh on
 *     first miss, matching the semantics of ghl-service.getCustomFieldIdByName).
 *  3. Find the contact by exact email match via GHL POST /contacts/search.
 *  4. PUT /contacts/{contactId} with customFields: [{ key, field_value }] —
 *     the standard GHL v1 contact update endpoint.
 *  5. Return the contact ID, field key, field ID, and updated value.
 */
async function updateContactCustomField(payload: ValidatedPayload): Promise<{
  success: true;
  contactId: string;
  contactName: string;
  email: string;
  customFieldName: string;
  customFieldKey: string;
  customFieldId: string;
  previousValue: string;
  updatedValue: string;
  locationId: string;
}> {
  // Step 1 — location scoping
  const locationId = await resolveLocation(payload.locationId);
  const accessToken = await getValidAccessToken(locationId);

  // Step 2 — custom field ID lookup (name -> ID)
  let customFieldId = await getCustomFieldIdByName(locationId, payload.customFieldName);
  if (!customFieldId) {
    // First miss: the in-memory cache may be stale (fields added in GHL after
    // boot). Clear it for this location and retry once.
    clearCustomFieldCache(locationId);
    customFieldId = await getCustomFieldIdByName(locationId, payload.customFieldName);
  }
  if (!customFieldId) {
    throw Object.assign(
      new Error(
        `Custom field "${payload.customFieldName}" does not exist in location ${locationId}. ` +
          "Create it in GHL under Settings > Custom Fields (Contacts)."
      ),
      { code: "CUSTOM_FIELD_NOT_FOUND" }
    );
  }

  // Step 3 — contact lookup by exact email match.
  const searchResponse = await fetch(`${GHL_BASE_URL}/contacts/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      locationId,
      filters: [{ field: "email", operator: "eq", value: payload.email }],
    }),
  });

  if (!searchResponse.ok) {
    const detail = await searchResponse.text();
    throw Object.assign(new Error(`GHL contacts/search failed: ${searchResponse.status} ${detail}`), {
      code: "CONTACT_SEARCH_FAILED",
    });
  }

  const searchData = (await searchResponse.json()) as {
    contacts?: Array<{
      id: string;
      email: string;
      firstName?: string;
      lastName?: string;
      customFields?: Array<{ fieldKey: string; field_value: any }>;
    }>;
  };

  const contact = searchData.contacts?.[0];
  if (!contact) {
    throw Object.assign(new Error(`No contact found for email "${payload.email}" in location ${locationId}`), {
      code: "CONTACT_NOT_FOUND",
    });
  }

  // Capture previous value if available (for the response)
  // GHL search returns customFields with fieldKey matching the custom field key,
  // so match by key (customFieldName) as well as ID to be robust.
  const prevField = contact.customFields?.find(
    (f) => f.fieldKey === customFieldId || f.fieldKey === payload.customFieldName
  );
  const previousValue = prevField ? String(prevField.field_value) : "";

  // Step 4 — Update the custom field
  const updateResponse = await fetch(`${GHL_BASE_URL}/contacts/${contact.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      customFields: [{ key: customFieldId, field_value: payload.value }],
    }),
  });

  if (!updateResponse.ok) {
    const detail = await updateResponse.text();
    throw Object.assign(new Error(`GHL contacts PUT failed: ${updateResponse.status} ${detail}`), {
      code: "CUSTOM_FIELD_UPDATE_FAILED",
    });
  }

  return {
    success: true,
    contactId: contact.id,
    contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
    email: payload.email,
    customFieldName: payload.customFieldName,
    customFieldKey: customFieldId,
    customFieldId: customFieldId,
    previousValue,
    updatedValue: payload.value,
    locationId,
  };
}

/**
 * Route Registration
 */
export function registerContactsCustomFieldRoutes(app: Express): void {
  /**
   * POST /api/contacts/update-custom-field
   *
   * Updates a single custom-field value on a CRM contact. Locates the contact
   * by exact email match, resolves the custom field ID from the field name,
   * and returns the contact ID, field ID, and updated value.
   *
   * Headers: Authorization: Internal-Key <key>
   */
  app.post("/api/contacts/update-custom-field", async (req, res) => {
    // 1. Authentication: Simple Internal-Key check
    const authHeader = req.headers.authorization || "";
    const expectedKey = ENV.internalApiKey;
    
    if (!authHeader || authHeader !== `Internal-Key ${expectedKey}`) {
      console.warn("[contacts-custom-field] Unauthorized request: Invalid or missing Internal-Key");
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        detail: "Invalid or missing Internal-Key",
      });
    }

    // 2. Validation
    if ((req as Request & { invalid_json?: boolean }).invalid_json) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
        code: "INVALID_PAYLOAD",
      });
    }

    const validation = validatePayload(req.body);
    if (!validation.payload) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        details: validation.errors,
      });
    }

    const { payload } = validation;

    // 3. Operation
    try {
      const result = await updateContactCustomField(payload);
      console.log(
        `[contacts-custom-field] Updated field "${payload.customFieldName}"=${payload.value} ` +
          `on contact ${result.contactId} (${payload.email}) in location ${payload.locationId}`
      );
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "GHL_OPERATION_FAILED";

      console.error(`[contacts-custom-field] Failed to update custom field: ${message}`);

      switch (code) {
        case "LOCATION_NOT_FOUND":
          return res.status(404).json({ success: false, error: "Location not found", code, detail: message, locationId: payload.locationId });
        case "CONTACT_NOT_FOUND":
          return res.status(404).json({ success: false, error: "Contact not found", code, detail: message, email: payload.email, locationId: payload.locationId });
        case "CUSTOM_FIELD_NOT_FOUND":
          return res.status(404).json({ success: false, error: "Custom field not found", code, detail: message, customFieldName: payload.customFieldName, locationId: payload.locationId });
        case "CONTACT_SEARCH_FAILED":
        case "CUSTOM_FIELD_UPDATE_FAILED":
        default:
          return res.status(422).json({ success: false, error: "GHL operation failed", code, detail: message, locationId: payload.locationId });
      }
    }
  });
}
