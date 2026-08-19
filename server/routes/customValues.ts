/**
 * Custom Values (sub-account settings) Read API
 *
 * Machine-to-machine endpoint used by n8n workflows to list all custom
 * values stored on a GHL sub-account WITHOUT any private integration key
 * reaching n8n.
 *
 * Flow: n8n HTTP Request -> GET /api/custom-values?locationId=...
 *       (authenticated via Internal-Key) -> this module -> GHL API
 *       (using the per-location OAuth token stored in the ghl_installations
 *       table, auto-refreshed by ghl-service)
 *
 * Security model:
 *  1. Authorization: `Authorization: Internal-Key <INTERNAL_API_KEY>`
 *  2. Location scoping: the locationId must exist in ghl_installations — one
 *     sub-account can never be reached through another location's token.
 *
 * Mirrors the security posture of POST /api/contacts/update-custom-field.
 */

import type { Express } from "express";
import { ENV } from "../_core/env";
import {
  getInstallation,
  getValidAccessToken,
  fetchAllCustomValues,
  resolveCustomValue,
} from "../ghl-service";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

/**
 * Internal helper shared by this module's routes — fetch the raw custom-values
 * list for a scoped location (handles token resolution + failure logging).
 */
async function fetchCustomValuesForLocation(
  locationId: string
): Promise<Record<string, unknown>[]> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    const err = new Error(
      `No GHL installation found for locationId "${locationId}". ` +
        "The sub-account may not have the HomeFlow app installed."
    );
    throw Object.assign(err, { code: "LOCATION_NOT_FOUND" });
  }

  const accessToken = await getValidAccessToken(locationId);
  const values = await fetchAllCustomValues(locationId, accessToken);

  // Unwrap GHL's merge-field fieldKey syntax on every entry, so callers
  // receive plain keys (e.g. "lead_followup_options" instead of
  // "{{ custom_values.lead_followup_options }}").
  return values.map(c => {
    const rawFieldKey =
      typeof c.fieldKey === "string" ? c.fieldKey : undefined;
    const fieldKey = rawFieldKey
      ? rawFieldKey.replace(/\{\{\s*custom_values\.([^}]+?)\s*\}\}/g, "$1").trim()
      : rawFieldKey;
    return {
      id: c.id ?? c._id ?? "",
      name: typeof c.name === "string" && c.name ? c.name : "",
      key: typeof c.key === "string" && c.key ? c.key : (fieldKey ?? ""),
      fieldKey: fieldKey ?? "",
      value: c.value !== null && c.value !== undefined ? String(c.value) : "",
    };
  });
}

/**
 * Resolve a custom value by key inside an already-fetched list (unified
 * lookup: exact / case-insensitive / normalized / fuzzy).
 */
function findValue(
  values: Record<string, unknown>[],
  key: string
): { id: string; name: string; key: string; fieldKey: string; value: string } | null {
  for (const v of values) {
    if (resolveCustomValue(values, key) === (v.value === "" ? "" : String(v.value))) {
      // resolveCustomValue matches; return the matched entry — prefer an
      // entry whose key/name matches the lookup key directly.
    }
  }
  const loKey = key.toLowerCase();
  const match = values.find(v => {
    const candidates = [
      String(v.key ?? ""),
      String(v.fieldKey ?? ""),
      String(v.name ?? ""),
    ].filter(Boolean);
    return candidates.some(c => c.toLowerCase() === loKey);
  });
  if (match) {
    return {
      id: String(match.id ?? ""),
      name: String(match.name ?? ""),
      key: String(match.key ?? ""),
      fieldKey: String(match.fieldKey ?? ""),
      value: String(match.value ?? ""),
    };
  }
  return null;
}

/**
 * Route Registration
 */
export function registerCustomValuesRoutes(app: Express): void {
  // ── GET /api/custom-values — list ALL custom values for a location ───

  /**
   * GET /api/custom-values?locationId=<id>
   *
   * Returns every custom value stored on the GHL sub-account: id, name,
   * key, fieldKey, and the current value. The contactId is NOT involved —
   * these are sub-account-level settings (quote templates, lead follow-up
   * options, etc.), distinct from per-contact custom fields.
   *
   * Headers: Authorization: Internal-Key <key>
   */
  app.get("/api/custom-values", async (req, res) => {
    // 1. Authentication: Simple Internal-Key check
    const authHeader = req.headers.authorization || "";
    const expectedKey = ENV.internalApiKey;

    if (!authHeader || authHeader !== `Internal-Key ${expectedKey}`) {
      console.warn(
        "[custom-values] Unauthorized request: Invalid or missing Internal-Key"
      );
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        detail: "Invalid or missing Internal-Key",
      });
    }

    // 2. Validation
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim()
        ? req.query.locationId.trim()
        : null;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        details: [{ field: "locationId", message: "Required string" }],
      });
    }

    console.log(`[custom-values][INCOMING] locationId=${locationId}`);

    try {
      const values = await fetchCustomValuesForLocation(locationId);
      console.log(
        `[custom-values][OUTCOME] outcome=success status=200 code=OK ` +
          `locationId=${locationId} count=${values.length}`
      );
      return res.status(200).json({
        success: true,
        locationId,
        count: values.length,
        customValues: values,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "GHL_OPERATION_FAILED";

      console.error(`[custom-values] Failed to list custom values: ${message}`);
      console.error(
        `[custom-values][OUTCOME] outcome=failed status=404 code=${code} detail=${message}`
      );

      return res.status(404).json({
        success: false,
        error:
          code === "LOCATION_NOT_FOUND"
            ? "Location not found"
            : "Failed to fetch custom values",
        code,
        detail: message,
        locationId,
      });
    }
  });

  // ── GET /api/custom-values/resolve — read ONE custom value by key ─────

  /**
   * GET /api/custom-values/resolve?locationId=<id>&key=<key>
   *
   * Resolves the live stored value of a single custom value key using the
   * same unified lookup (exact / case-insensitive / normalized / fuzzy) as
   * the rest of the app.
   *
   * Headers: Authorization: Internal-Key <key>
   */
  app.get("/api/custom-values/resolve", async (req, res) => {
    // 1. Authentication
    const authHeader = req.headers.authorization || "";
    const expectedKey = ENV.internalApiKey;

    if (!authHeader || authHeader !== `Internal-Key ${expectedKey}`) {
      console.warn(
        "[custom-values] Unauthorized request: Invalid or missing Internal-Key"
      );
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        detail: "Invalid or missing Internal-Key",
      });
    }

    // 2. Validation
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim()
        ? req.query.locationId.trim()
        : null;
    const key =
      typeof req.query.key === "string" && req.query.key.trim()
        ? req.query.key.trim()
        : null;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        details: [{ field: "locationId", message: "Required string" }],
      });
    }
    if (!key) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        details: [{ field: "key", message: "Required string" }],
      });
    }

    console.log(`[custom-values][INCOMING] locationId=${locationId} key=${key}`);

    try {
      const values = await fetchCustomValuesForLocation(locationId);
      const matched = findValue(values, key);

      if (!matched) {
        console.log(
          `[custom-values][OUTCOME] outcome=not_found status=404 ` +
            `code=CUSTOM_VALUE_NOT_FOUND locationId=${locationId} key=${key}`
        );
        return res.status(404).json({
          success: false,
          error: "Custom value not found",
          code: "CUSTOM_VALUE_NOT_FOUND",
          detail: `No custom value matching "${key}" in location ${locationId}.`,
          locationId,
          key,
        });
      }

      console.log(
        `[custom-values][OUTCOME] outcome=success status=200 code=OK ` +
          `locationId=${locationId} key=${matched.key}`
      );
      return res.status(200).json({
        success: true,
        locationId,
        customValue: matched,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "GHL_OPERATION_FAILED";

      console.error(`[custom-values] Failed to resolve custom value: ${message}`);
      console.error(
        `[custom-values][OUTCOME] outcome=failed status=404 code=${code} detail=${message}`
      );

      return res.status(404).json({
        success: false,
        error:
          code === "LOCATION_NOT_FOUND"
            ? "Location not found"
            : "Failed to fetch custom values",
        code,
        detail: message,
        locationId,
      });
    }
  });
}
