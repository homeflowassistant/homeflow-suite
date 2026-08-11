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
 * (getValidAccessToken, getInstallation).
 */

import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import {
  getValidAccessToken,
  getInstallation,
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
 *  2. Fetch ALL custom fields from GHL and match by name to get the field ID.
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

  // Step 2 — Fetch ALL custom fields from GHL and match by name.
  // This ensures we always have the latest data and avoids stale cache issues.
  // GET /locations/:locationId/customFields?model=contact — the official GHL
  // endpoint for listing a sub-account's contact custom fields.
  const fieldsResponse = await fetch(
    `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
    }
  );

  if (!fieldsResponse.ok) {
    const detail = await fieldsResponse.text();
    throw Object.assign(new Error(`GHL custom-fields GET failed: ${fieldsResponse.status} ${detail}`), {
      code: "CUSTOM_FIELD_LOOKUP_FAILED",
    });
  }

  const fieldsData = (await fieldsResponse.json()) as {
    customFields?: Array<{
      id: string;
      name: string;
      fieldKey?: string;
      fieldType: string;
    }>;
  };

  const matchedField = fieldsData.customFields?.find(
    (f) => f.name.toLowerCase() === payload.customFieldName.toLowerCase()
  );

  if (!matchedField) {
    throw Object.assign(
      new Error(
        `Custom field "${payload.customFieldName}" does not exist in location ${locationId}. ` +
          "Create it in GHL under Settings > Custom Fields (Contacts)."
      ),
      { code: "CUSTOM_FIELD_NOT_FOUND" }
    );
  }

  const customFieldId = matchedField.id;

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
      pageLimit: 1,
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
  const prevField = contact.customFields?.find(
    (f) => f.fieldKey === customFieldId || f.fieldKey === matchedField.fieldKey
  );
  const previousValue = prevField ? String(prevField.field_value) : "";

  // Step 4 — Update the custom field.
  // GHL's contact PUT endpoint resolves custom fields by their `key`, which is
  // the fieldKey (e.g. "contact.quote_slug") — not the internal numeric id.
  // We send the fieldKey as the key since that is what GHL uses for lookups.
  const updateKey = matchedField.fieldKey || payload.customFieldName;
  const updateResponse = await fetch(`${GHL_BASE_URL}/contacts/${contact.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      customFields: [{ key: updateKey, field_value: payload.value }],
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
    customFieldKey: matchedField.fieldKey || matchedField.name,
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
   * by exact email match, fetches all custom fields from GHL to find the ID,
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
        case "CUSTOM_FIELD_LOOKUP_FAILED":
          return res.status(404).json({ success: false, error: "Custom field not found or lookup failed", code, detail: message, customFieldName: payload.customFieldName, locationId: payload.locationId });
        case "CONTACT_SEARCH_FAILED":
        case "CUSTOM_FIELD_UPDATE_FAILED":
        default:
          return res.status(422).json({ success: false, error: "GHL operation failed", code, detail: message, locationId: payload.locationId });
      }
    }
  });
}
