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

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Debug log — lets you inspect what data arrives at this endpoint and how
 * it was mapped onto the GHL contact (visible on Render via the debug GET
 * endpoint below). In-memory, capped, process-scoped: it resets on every
 * Render restart and never touches the database. Safe for production use
 * as long as n8n is the only caller, since the same Internal-Key gate
 * protects the debug endpoint.
 * ═══════════════════════════════════════════════════════════════════════
 */
interface DebugLogEntry {
  at: string; // ISO timestamp (UTC)
  mode: "legacy" | "batch";
  request: {
    locationId: string;
    email: string;
    /** The incoming payload exactly as it arrived (legacy shape or batch entries). */
    incomingFields: Array<{ customFieldName: string; value: any }>;
  };
  outcome: "success" | "partial" | "failed";
  statusCode: number;
  code: string;
  /** The fields actually sent to GHL's PUT (id/key/fieldValue mappings). */
  mappedToGhl?: Array<{ id: string; key: string; fieldValue: string }>;
  detail?: string;
}

const DEBUG_LOG_CAPACITY = 100;
const debugLog: DebugLogEntry[] = [];

function recordDebugEntry(entry: DebugLogEntry): void {
  debugLog.unshift(entry);
  if (debugLog.length > DEBUG_LOG_CAPACITY) debugLog.length = DEBUG_LOG_CAPACITY;
}

function resetDebugLog(): void {
  debugLog.length = 0;
}
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

// ═══════════════════════════════════════════════════════════════════════
// Multi-field (batch) support — additive, legacy path untouched above.
// ═══════════════════════════════════════════════════════════════════════

/**
 * One entry of a batch multi-field update request.
 */
interface BatchFieldInput {
  customFieldName: string;
  value: string | number | boolean;
}

/**
 * Per-field result included in a batch response.
 */
interface BatchFieldResult {
  customFieldName: string;
  customFieldKey: string;
  customFieldId: string;
  previousValue: string;
  updatedValue: string;
  success: boolean;
  code?: string;
  detail?: string;
}

/**
 * Batch payload validation.
 *
 * Requires the same locationId + email rules as the legacy endpoint, plus a
 * non-empty `customFields` array where every entry has a non-empty string
 * `customFieldName` and a present, non-empty `value` — mirroring the legacy
 * single-field value rule per entry.
 */
function validateBatchPayload(body: any): {
  payload: { locationId: string; email: string; contactName?: string } | null;
  fieldErrors: Array<{ index: number; customFieldName: string; message: string }>;
  errors: Array<{ field: string; message: string }>;
} {
  const errors: Array<{ field: string; message: string }> = [];
  const fieldErrors: Array<{ index: number; customFieldName: string; message: string }> = [];

  if (!body.locationId || typeof body.locationId !== "string") {
    errors.push({ field: "locationId", message: "Required string" });
  }
  if (!body.email || typeof body.email !== "string" || !body.email.includes("@")) {
    errors.push({ field: "email", message: "Required valid email string" });
  }
  if (!Array.isArray(body.customFields) || body.customFields.length === 0) {
    errors.push({ field: "customFields", message: "Required non-empty array" });
  }

  if (errors.length > 0) return { payload: null, fieldErrors: [], errors };

  for (let i = 0; i < body.customFields.length; i++) {
    const entry = body.customFields[i];
    if (!entry || typeof entry !== "object") {
      fieldErrors.push({ index: i, customFieldName: String(entry), message: "Entry must be an object" });
      continue;
    }
    if (!entry.customFieldName || typeof entry.customFieldName !== "string") {
      fieldErrors.push({ index: i, customFieldName: String(entry.customFieldName ?? ""), message: "customFieldName is required" });
      continue;
    }
    if (entry.value === undefined || entry.value === null || entry.value === "") {
      fieldErrors.push({ index: i, customFieldName: entry.customFieldName, message: "value is required (string, number, or boolean)" });
    }
  }

  if (fieldErrors.length > 0) return { payload: null, fieldErrors, errors: [] };

  return {
    payload: {
      locationId: body.locationId,
      email: body.email,
      contactName: body.contactName ? String(body.contactName) : undefined,
    },
    fieldErrors: [],
    errors: [],
  };
}

/**
 * Batch contact custom-field update logic.
 *
 * Same primitives as the single-field path, but issued once for the whole
 * batch — GHL's PUT /contacts/{id} natively accepts a `customFields` array,
 * so this sends ONE combined CRM request instead of N.
 *
 *  1. Resolve the location via ghl_installations (location scoping).
 *  2. Fetch ALL custom fields from GHL once; resolve every requested name.
 *     Fields that cannot be resolved are collected into `failingFields` —
 *     the valid fields still proceed, so one bad name never fails the rest.
 *  3. Find the contact by exact email match via GHL POST /contacts/search.
 *  4. PUT /contacts/{contactId} with customFields: [{ id, key, fieldValue }]
 *     for every resolvable field — one combined API request.
 *  5. Return per-field results (previous/updated values per field).
 */
async function updateContactCustomFieldsBatch(
  payload: { locationId: string; email: string },
  fields: BatchFieldInput[]
): Promise<{
  success: boolean;
  contactId: string;
  contactName: string;
  email: string;
  locationId: string;
  updatedFields: BatchFieldResult[];
  failingFields: Array<{ customFieldName: string; code: string; detail: string }>;
}> {
  // Step 1 — location scoping (identical to the single-field path).
  const locationId = await resolveLocation(payload.locationId);
  const accessToken = await getValidAccessToken(locationId);

  // Step 2 — fetch the custom-field list ONCE and resolve every requested
  // name. Unresolvable names go straight into failingFields (CUSTOM_FIELD_NOT_FOUND)
  // without failing the remaining fields.
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
    customFields?: Array<{ id: string; name: string; fieldKey?: string; fieldType: string }>;
  };

  const failingFields: Array<{ customFieldName: string; code: string; detail: string }> = [];
  const resolved: Array<{
    input: BatchFieldInput;
    matchedField: { id: string; name: string; fieldKey?: string };
  }> = [];

  for (const input of fields) {
    const matchedField = fieldsData.customFields?.find(
      (f) =>
        f.fieldKey?.toLowerCase() === input.customFieldName.toLowerCase() ||
        f.name.toLowerCase() === input.customFieldName.toLowerCase()
    );
    if (!matchedField) {
      failingFields.push({
        customFieldName: input.customFieldName,
        code: "CUSTOM_FIELD_NOT_FOUND",
        detail:
          `Custom field "${input.customFieldName}" does not exist in location ${locationId}. ` +
          "Create it in GHL under Settings > Custom Fields (Contacts).",
      });
    } else {
      resolved.push({ input, matchedField });
    }
  }

  // Step 3 — contact lookup by exact email match (once, for the whole batch).
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

  // Step 4 — if there is at least one resolvable field, issue ONE combined
  // PUT with the full customFields array (GHL natively supports this shape).
  const updatedFields: BatchFieldResult[] = [];
  if (resolved.length > 0) {
    const updateResponse = await fetch(`${GHL_BASE_URL}/contacts/${contact.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify({
        customFields: resolved.map(({ input, matchedField }) => ({
          id: matchedField.id,
          key: matchedField.fieldKey || input.customFieldName,
          fieldValue: String(input.value),
        })),
      }),
    });

    if (!updateResponse.ok) {
      const detail = await updateResponse.text();
      throw Object.assign(new Error(`GHL contacts PUT failed: ${updateResponse.status} ${detail}`), {
        code: "CUSTOM_FIELD_UPDATE_FAILED",
      });
    }
  }

  // Step 5 — build per-field results using the same search snapshot as the
  // single-field endpoint (previousValue comes from the contact snapshot).
  for (const { input, matchedField } of resolved) {
    const prevField = contact.customFields?.find(
      (f) => f.fieldKey === matchedField.id || f.fieldKey === matchedField.fieldKey
    );
    updatedFields.push({
      customFieldName: input.customFieldName,
      customFieldKey: matchedField.fieldKey || matchedField.name,
      customFieldId: matchedField.id,
      previousValue: prevField ? String(prevField.field_value) : "",
      updatedValue: String(input.value),
      success: true,
    });
  }

  return {
    success: failingFields.length === 0,
    contactId: contact.id,
    contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
    email: payload.email,
    locationId,
    updatedFields,
    failingFields,
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

  // Match by fieldKey first (e.g. "contact.quote_slug"), then fall back to field name.
  const matchedField = fieldsData.customFields?.find(
    (f) =>
      f.fieldKey?.toLowerCase() === payload.customFieldName.toLowerCase() ||
      f.name.toLowerCase() === payload.customFieldName.toLowerCase()
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
  // GHL's Update Contact (PUT) endpoint expects customFields entries in this
  // exact shape (per official v3 docs):
  //   { "id": "<internal_field_id>", "key": "<fieldKey>", "fieldValue": "<value>" }
  // Sending `field_value` (snake_case) or omitting `id` causes GHL to return 200
  // but silently ignore the update.
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
      customFields: [
        {
          id: customFieldId,
          key: updateKey,
          fieldValue: payload.value,
        },
      ],
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

    // ── Multi-field (batch) path ─────────────────────────────────────
    // Entered ONLY when no top-level customFieldName/value are present and a
    // non-empty customFields array is provided. The legacy branch below is
    // reached for everything else, so existing payloads are unchanged.
    const hasLegacy = req.body.customFieldName !== undefined || req.body.value !== undefined;
    const hasBatch = Array.isArray(req.body.customFields) && req.body.customFields.length > 0;

    if (!hasLegacy && hasBatch) {
      const batchValidation = validateBatchPayload(req.body);
      if (!batchValidation.payload) {
        return res.status(400).json({
          success: false,
          error: "Invalid payload",
          code: "INVALID_PAYLOAD",
          details: batchValidation.errors.length > 0 ? batchValidation.errors : batchValidation.fieldErrors,
        });
      }

      try {
        const result = await updateContactCustomFieldsBatch(batchValidation.payload, req.body.customFields);
        console.log(
          `[contacts-custom-field] Batch updated ${result.updatedFields.length} field(s) ` +
            (result.failingFields.length > 0 ? `with ${result.failingFields.length} failing ` : "") +
            `on contact ${result.contactId} (${req.body.email}) in location ${req.body.locationId}`
        );
        recordDebugEntry({
          at: new Date().toISOString(),
          mode: "batch",
          request: {
            locationId: req.body.locationId,
            email: req.body.email,
            incomingFields: req.body.customFields.map((e: BatchFieldInput) => ({ customFieldName: e.customFieldName, value: e.value })),
          },
          outcome: result.success ? "success" : "partial",
          statusCode: 200,
          code: result.success ? "OK" : "PARTIAL_UPDATE_FAILED",
          mappedToGhl: result.updatedFields.map((f) => ({ id: f.customFieldId, key: f.customFieldKey, fieldValue: f.updatedValue })),
          detail:
            result.failingFields.length > 0
              ? result.failingFields.map((f) => `${f.customFieldName} (${f.code})`).join("; ")
              : undefined,
        });
        if (result.success) {
          return res.status(200).json(result);
        }
        return res.status(200).json({
          ...result,
          error: "Some custom fields failed to update",
          code: "PARTIAL_UPDATE_FAILED",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? "GHL_OPERATION_FAILED";

        console.error(`[contacts-custom-field] Failed to batch-update custom fields: ${message}`);

        recordDebugEntry({
          at: new Date().toISOString(),
          mode: "batch",
          request: {
            locationId: req.body.locationId,
            email: req.body.email,
            incomingFields: Array.isArray(req.body.customFields)
              ? req.body.customFields.map((e: BatchFieldInput) => ({ customFieldName: e.customFieldName ?? "", value: e.value }))
              : [],
          },
          outcome: "failed",
          statusCode: code === "LOCATION_NOT_FOUND" || code === "CONTACT_NOT_FOUND" || code === "CUSTOM_FIELD_NOT_FOUND" || code === "CUSTOM_FIELD_LOOKUP_FAILED" ? 404 : 422,
          code,
          detail: message,
        });

        switch (code) {
          case "LOCATION_NOT_FOUND":
            return res.status(404).json({ success: false, error: "Location not found", code, detail: message, locationId: req.body.locationId });
          case "CONTACT_NOT_FOUND":
            return res.status(404).json({ success: false, error: "Contact not found", code, detail: message, email: req.body.email, locationId: req.body.locationId });
          case "CUSTOM_FIELD_NOT_FOUND":
          case "CUSTOM_FIELD_LOOKUP_FAILED":
            return res.status(404).json({ success: false, error: "Custom field not found or lookup failed", code, detail: message, locationId: req.body.locationId });
          case "CONTACT_SEARCH_FAILED":
          case "CUSTOM_FIELD_UPDATE_FAILED":
          default:
            return res.status(422).json({ success: false, error: "GHL operation failed", code, detail: message, locationId: req.body.locationId });
        }
      }
    }

    // ── Legacy single-field path (unchanged) ─────────────────────────
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
      recordDebugEntry({
        at: new Date().toISOString(),
        mode: "legacy",
        request: {
          locationId: payload.locationId,
          email: payload.email,
          incomingFields: [{ customFieldName: payload.customFieldName, value: payload.value }],
        },
        outcome: "success",
        statusCode: 200,
        code: "OK",
        mappedToGhl: [{ id: result.customFieldId, key: result.customFieldKey, fieldValue: result.updatedValue }],
      });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "GHL_OPERATION_FAILED";

      console.error(`[contacts-custom-field] Failed to update custom field: ${message}`);

      recordDebugEntry({
        at: new Date().toISOString(),
        mode: "legacy",
        request: {
          locationId: payload.locationId,
          email: payload.email,
          incomingFields: [{ customFieldName: payload.customFieldName, value: payload.value }],
        },
        outcome: "failed",
        statusCode: code === "LOCATION_NOT_FOUND" || code === "CONTACT_NOT_FOUND" || code === "CUSTOM_FIELD_NOT_FOUND" || code === "CUSTOM_FIELD_LOOKUP_FAILED" ? 404 : 422,
        code,
        detail: message,
      });

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

  /**
   * GET /api/contacts/update-custom-field/debug
   *
   * Inspects what data arrived at the update-custom-field endpoint and how it
   * was mapped onto the GHL contact. Protected by the same Internal-Key gate
   * as the POST endpoint, so only your own clients (n8n, your own tooling)
   * can read it.
   *
   * The log is in-memory, capped at ${DEBUG_LOG_CAPACITY} entries, and resets
   * on every Render restart — it is a debugging aid, not a persistence layer.
   *
   * Query params (optional):
   *  ?limit=N      — number of recent entries to return (default 20, max 100)
   *  ?mode=legacy|batch — filter by request mode
   *  ?clear=true   — empty the log and return the (now empty) snapshot
   */
  app.get("/api/contacts/update-custom-field/debug", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const expectedKey = ENV.internalApiKey;

    if (!authHeader || authHeader !== `Internal-Key ${expectedKey}`) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        detail: "Invalid or missing Internal-Key",
      });
    }

    if ((req.query.clear as string) === "true") {
      resetDebugLog();
      return res.status(200).json({
        success: true,
        entries: [],
        total: 0,
        note: "Debug log cleared. Log is in-memory and resets on every Render restart.",
      });
    }

    const mode = req.query.mode;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), DEBUG_LOG_CAPACITY);

    const filtered =
      mode === "legacy" || mode === "batch"
        ? debugLog.filter((e) => e.mode === mode)
        : debugLog;

    return res.status(200).json({
      success: true,
      total: filtered.length,
      returned: Math.min(limit, filtered.length),
      note: "In-memory log — oldest entries drop off, and the whole log resets on Render restart.",
      entries: filtered.slice(0, limit),
    });
  });
}
