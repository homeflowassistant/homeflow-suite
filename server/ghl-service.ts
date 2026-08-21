/**
 * GoHighLevel Service Module
 *
 * Handles:
 * - OAuth token exchange (authorization code → access + refresh tokens)
 * - Automatic token refresh before expiry
 * - GHL API calls (create contact, add to workflow)
 * - Installation management (CRUD on ghl_installations table)
 */

import { eq, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { ENV } from "./_core/env.js";
import { ghlInstallations, type GHLInstallation } from "../drizzle/schema.js";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
// Refresh tokens 10 minutes before they expire
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

export const ACTIVE_TO_COMPLETED_TAGS: Record<string, string> = {
  "new lead (via homeflow)": "new lead finished",
  "homeflow: inactive customer": "homeflow: inactive customer finished",
  "add-on-campaign": "add-on-campaign finished",
};

export function getCompletedTagForActive(tagName: string): string | undefined {
  return ACTIVE_TO_COMPLETED_TAGS[tagName];
}

// ─── Types ───────────────────────────────────────────────────────────

export interface GHLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
}

export interface GHLContactData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  dnd?: boolean;
  tagName?: string;
  customFields?: Array<{ fieldKey: string; fieldValue?: unknown }>;
}

export interface GHLCreateContactResponse {
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    locationId: string;
    dnd: boolean;
  };
}

// ─── Custom Value Map Utilities ─────────────────────────────────────

function matchesCustomKey(apiKey: string, configKey: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s-]/g, "_");
  return (
    normalize(apiKey) === normalize(configKey) ||
    normalize(apiKey) === `contact.${normalize(configKey)}` ||
    apiKey === configKey
  );
}

function getCustomValueMap(
  customValues: Record<string, unknown>[]
): Map<string, { id: string; value: string }> {
  const map = new Map<string, { id: string; value: string }>();

  for (const customValue of customValues) {
    const key =
      typeof customValue.fieldKey === "string"
        ? customValue.fieldKey
        : typeof customValue.name === "string"
          ? customValue.name
          : "";
    const id = typeof customValue.id === "string" ? customValue.id : "";
    const value =
      typeof customValue.value === "string" ? customValue.value : "";

    if (!key || !id) continue;
    map.set(key, { id, value });
  }

  return map;
}

export async function getLocationCustomValueMap(
  locationId: string
): Promise<Map<string, { id: string; value: string }>> {
  const { accessToken } = await getAccessTokenAndInstallation(locationId);
  const response = await fetchJson<{
    customValues?: Record<string, unknown>[];
  }>(
    `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`,
    accessToken,
    { method: "GET" }
  );

  return getCustomValueMap(response.customValues ?? []);
}

async function getAccessTokenAndInstallation(locationId: string) {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  return {
    installation,
    accessToken: await getValidAccessToken(locationId),
  };
}

async function fetchJson<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GHL request failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

// ─── Custom Field Discovery ──────────────────────────────────────────

const customFieldCache = new Map<string, Map<string, string>>();

/**
 * Extract the raw custom-value key from GHL's merge-field syntax.
 * e.g. "{{ custom_values.lead_followup_options }}" -> "lead_followup_options"
 * Returns the input unchanged if no merge-field wrapper is found.
 */
export function extractCustomValueKey(fieldKey: string): string {
  const m = fieldKey.match(/\{\{\s*custom_values\.([^}]+?)\s*\}\}/);
  return m ? m[1].trim() : fieldKey;
}

/**
 * Resolve a custom-value key to its current value from a fetched
 * custom-values list.
 *
 * Priority rules (used on every popup open):
 * 1. Unwrap GHL's merge-field syntax — fieldKey `{{ custom_values.lead_followup_options }}`
 *    is matched as plain `lead_followup_options`.
 * 2. Case-insensitive exact match against unwrapped fieldKey, raw fieldKey, key, and name.
 * 3. Normalized match (strips all non-alphanumeric chars).
 * 4. Fuzzy substring match via findCustomValueId (catches display names like
 *    "Lead Follow-up Options (Lite, SG-Link, Custom-Link)").
 *
 * Returns the stored value trimmed, or "" when the custom value does not
 * exist or its value is empty/unavailable — the caller falls back to the
 * default value in that case.
 */
export function resolveCustomValue(
  customValues: Record<string, unknown>[],
  key: string
): string {
  if (!key) return "";
  const get = (name: string): string => {
    const cv = customValues.find(c => {
      const unwrapped =
        typeof c.fieldKey === "string" && c.fieldKey
          ? extractCustomValueKey(c.fieldKey)
          : undefined;
      const k = unwrapped ?? (typeof c.fieldKey === "string" ? c.fieldKey : "") ?? "";
      const n = (typeof c.name === "string" && c.name) || (typeof c.key === "string" ? c.key : "") || "";
      const loKey = key.toLowerCase();
      return (
        k.toLowerCase() === loKey ||
        n.toLowerCase() === loKey ||
        normalizeKey(k) === normalizeKey(key) ||
        normalizeKey(n) === normalizeKey(key)
      );
    });
    const raw = (cv as { value?: unknown } | undefined)?.value;
    return raw !== null && raw !== undefined ? String(raw).trim() : "";
  };

  const exact = get(key);
  if (exact !== "") return exact;

  // Fuzzy fallback: key may exist but hold an empty value — resolve the ID
  // so the caller can still distinguish "field exists, value empty" from
  // "field does not exist".
  const id = findCustomValueId(customValues, key);
  if (id) {
    const matched = customValues.find(c => (c.id || c._id) === id);
    const raw = (matched as { value?: unknown } | undefined)?.value;
    return raw !== null && raw !== undefined ? String(raw).trim() : "";
  }
  return "";
}

function normalizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

async function fetchLocationCustomFields(
  locationId: string,
  accessToken: string
): Promise<Array<{ id: string; fieldKey: string; displayName?: string }>> {
  const response = await fetch(
    `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/custom-fields`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[GHL] Failed to fetch custom fields: ${response.status} ${errorBody}`
    );
    return [];
  }

  const data = (await response.json()) as Record<string, any>;
  const fieldsArray = (
    Array.isArray(data.customFields) ? data.customFields : (data.fields ?? [])
  ) as any[];

  return fieldsArray
    .filter(
      (field: any): field is Record<string, unknown> =>
        !!field && typeof field === "object"
    )
    .map((field: Record<string, any>) => ({
      id: typeof field.id === "string" ? field.id : "",
      fieldKey:
        typeof field.fieldKey === "string"
          ? field.fieldKey
          : typeof field.name === "string"
            ? field.name
            : "",
      displayName:
        typeof field.displayName === "string"
          ? field.displayName
          : typeof field.name === "string"
            ? field.name
            : "",
    }))
    .filter((field: any) => field.id && field.fieldKey);
}

export async function getCustomFieldIdByName(
  locationId: string,
  fieldNamePattern: string
): Promise<string | null> {
  const normalizedPattern = normalizeFieldName(fieldNamePattern);

  if (customFieldCache.has(locationId)) {
    const cachedFields = customFieldCache.get(locationId);
    if (cachedFields && cachedFields.has(normalizedPattern)) {
      return cachedFields.get(normalizedPattern) ?? null;
    }
  }

  try {
    const accessToken = await getValidAccessToken(locationId);
    const fields = await fetchLocationCustomFields(locationId, accessToken);

    const fieldMap = new Map<string, string>();
    for (const field of fields) {
      const normalized = normalizeFieldName(field.fieldKey);
      fieldMap.set(normalized, field.id);
    }

    customFieldCache.set(locationId, fieldMap);

    const found = fieldMap.get(normalizedPattern) ?? null;
    if (!found) {
      const available = Array.from(fieldMap.keys()).slice(0, 50).join(", ");
      console.warn(
        `[GHL] Custom field not found for pattern "${fieldNamePattern}". Available fields: ${available}`
      );
    }

    return found;
  } catch (error) {
    console.error(
      `[GHL] Error discovering custom field "${fieldNamePattern}":`,
      error
    );
    return null;
  }
}

export function clearCustomFieldCache(locationId?: string): void {
  if (locationId) {
    customFieldCache.delete(locationId);
  } else {
    customFieldCache.clear();
  }
}

// ─── Custom Value Upsert ─────────────────────────────────────────────

/**
 * Normalize a custom-value key for comparison.
 * Strips "contact." prefix, removes all non-alphanumeric chars, lowercases.
 */
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/^contact\./, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Find a custom value by name across all possible GHL key fields.
 * Uses a broad matching strategy: exact, case-insensitive, normalized.
 */
/**
 * Find a custom value by name across all possible GHL key fields.
 * Uses a broad multi-tier matching strategy: exact, case-insensitive, normalized, and substring/prefix.
 */
export function findCustomValueId(
  customValues: Record<string, unknown>[],
  targetName: string
): string | undefined {
  if (
    !customValues ||
    !Array.isArray(customValues) ||
    customValues.length === 0
  ) {
    return undefined;
  }

  const normTarget = normalizeKey(targetName);

  // Tier 1: Exact or case-insensitive match
  for (const cv of customValues) {
    const id =
      typeof cv.id === "string"
        ? cv.id
        : typeof cv._id === "string"
          ? cv._id
          : undefined;
    if (!id) continue;

    const candidates = [
      typeof cv.fieldKey === "string" ? cv.fieldKey : undefined,
      typeof cv.key === "string" ? cv.key : undefined,
      typeof cv.name === "string" ? cv.name : undefined,
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      if (
        cand === targetName ||
        cand.toLowerCase() === targetName.toLowerCase()
      ) {
        return id;
      }
    }
  }

  // Tier 2: Normalized exact match
  for (const cv of customValues) {
    const id =
      typeof cv.id === "string"
        ? cv.id
        : typeof cv._id === "string"
          ? cv._id
          : undefined;
    if (!id) continue;

    const candidates = [
      typeof cv.fieldKey === "string" ? cv.fieldKey : undefined,
      typeof cv.key === "string" ? cv.key : undefined,
      typeof cv.name === "string" ? cv.name : undefined,
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      const normCand = normalizeKey(cand);
      if (normCand === normTarget) {
        return id;
      }
    }
  }

  // Tier 3: Substring / pattern match (e.g. "lead_followup_options" inside "Lead Follow-up Options (Lite, SG-Link, Custom-Link)")
  for (const cv of customValues) {
    const id =
      typeof cv.id === "string"
        ? cv.id
        : typeof cv._id === "string"
          ? cv._id
          : undefined;
    if (!id) continue;

    const candidates = [
      typeof cv.fieldKey === "string" ? cv.fieldKey : undefined,
      typeof cv.key === "string" ? cv.key : undefined,
      typeof cv.name === "string" ? cv.name : undefined,
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      const normCand = normalizeKey(cand);
      if (
        normCand.includes(normTarget) ||
        normTarget.includes(normCand) ||
        (normTarget.startsWith("leadfollowup") &&
          normCand.startsWith("leadfollowup"))
      ) {
        return id;
      }
    }
  }

  return undefined;
}

/**
 * Fetch all custom values for a location.
 */
export async function fetchAllCustomValues(
  locationId: string,
  accessToken: string
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.warn(
      `[GHL] Failed to fetch custom values: ${response.status} ${body}`
    );
    return [];
  }

  const data = (await response.json()) as Record<string, any>;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.customValues)) return data.customValues;
  if (Array.isArray(data.custom_values)) return data.custom_values;
  if (Array.isArray(data.values)) return data.values;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

export async function uploadToGhlMedia(
  locationId: string,
  base64Data: string,
  fileName: string
): Promise<string> {
  const accessToken = await getValidAccessToken(locationId);

  // If it's already a URL (not base64), return as-is — no upload needed
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    console.log(
      `[GHL Media] Skipping upload for '${fileName}' — not base64, returning as-is.`
    );
    return base64Data;
  }

  const mimeType = matches[1];
  const base64Content = matches[2];

  // Convert base64 to binary buffer
  const buffer = Buffer.from(base64Content, "base64");

  console.log(
    `[GHL Media] Uploading '${fileName}' (type: ${mimeType}, size: ${buffer.length} bytes) to location ${locationId}`
  );

  // Use the v3 medias/upload-file endpoint with multipart form-data
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: mimeType }), fileName);

  const response = await fetch(
    "https://services.leadconnectorhq.com/medias/upload-file",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "v3",
        Accept: "application/json",
      },
      body: formData as any,
    }
  );

  const responseBody = await response.text();

  if (!response.ok) {
    console.error(
      `[GHL Media] Upload FAILED for '${fileName}': HTTP ${response.status} — ${responseBody}`
    );
    // Return empty string instead of raw base64 so the Custom Value doesn't store junk
    return "";
  }

  // Parse the JSON response
  let data: Record<string, any>;
  try {
    data = JSON.parse(responseBody);
  } catch (parseErr) {
    console.error(
      `[GHL Media] Failed to parse upload response for '${fileName}': ${responseBody}`
    );
    return "";
  }

  // The v3 API returns { fileId, url } — url is the hosted GCS URL
  const hostedUrl = data.url;
  if (hostedUrl) {
    console.log(`[GHL Media] Upload SUCCESS for '${fileName}': ${hostedUrl}`);
    return hostedUrl;
  }

  // Fallback: try fileId
  if (data.fileId) {
    console.warn(
      `[GHL Media] No 'url' in response for '${fileName}', falling back to fileId: ${data.fileId}`
    );
    return data.fileId;
  }

  console.error(
    `[GHL Media] Unexpected response for '${fileName}': ${responseBody}`
  );
  return "";
}

export async function updateExistingCustomValuesOnly(
  locationId: string,
  updates: Record<string, string>
): Promise<void> {
  const accessToken = await getValidAccessToken(locationId);

  // Step 1: Fetch all existing custom values for this sub-account
  const cvs = await fetchAllCustomValues(locationId, accessToken);
  if (!cvs || cvs.length === 0) {
    console.warn(
      `[GHL] No custom values found for location ${locationId}. Skipping all updates.`
    );
    return;
  }

  // Step 2: Build a map of key → { id, displayName } from existing custom values
  // (checking fieldKey, key, and name fields)
  const existingMap = new Map<string, { id: string; displayName: string }>();
  for (const cv of cvs) {
    const id = (cv.id || cv._id) as string | undefined;
    if (!id) continue;

    // Find the display name — prefer 'name', then 'fieldKey', then 'key'
    const displayName =
      typeof cv.name === "string" && cv.name
        ? cv.name
        : typeof cv.fieldKey === "string" && cv.fieldKey
          ? cv.fieldKey
          : typeof cv.key === "string" && cv.key
            ? cv.key
            : ""; // fallback — will use the requested key as name in the PUT body

    // GHL returns fieldKey wrapped in merge-field syntax, e.g.
    // "{{ custom_values.lead_followup_options }}" — unwrap it so plain keys
    // like "lead_followup_options" can be matched directly.
      const unwrapped =
      typeof cv.fieldKey === "string" && cv.fieldKey
        ? extractCustomValueKey(cv.fieldKey)
        : undefined;

    const keys = [
      typeof unwrapped === "string" ? unwrapped : undefined,
      typeof cv.fieldKey === "string" ? cv.fieldKey : undefined,
      typeof cv.key === "string" ? cv.key : undefined,
      typeof cv.name === "string" ? cv.name : undefined,
    ].filter(Boolean) as string[];

    for (const k of keys) {
      existingMap.set(k, { id, displayName });
      existingMap.set(normalizeKey(k), { id, displayName });
    }
  }

  // Step 3: For each requested update, PUT only if the key already exists

  // IMPORTANT: Preserve the original display name (GHL API requires the display name
  // in the PUT body — passing the key would silently rename the custom value)
  const promises = Object.entries(updates).map(async ([key, value]) => {
    let entry = existingMap.get(key) || existingMap.get(normalizeKey(key));

    // Fallback: fuzzy search (exact / case-insensitive / normalized /
    // substring) across all candidate name fields — catches cases where the
    // display name differs from the config key, e.g. "Lead Follow-up Options
    // (Lite, SG-Link, Custom-Link)" vs "lead_followup_options"
    if (!entry) {
      const fuzzyId = findCustomValueId(cvs, key);
      if (fuzzyId) {
        const matched = cvs.find(
          c => (c.id || c._id) === fuzzyId
        ) as Record<string, unknown> | undefined;
        if (matched) {
          const matchedName =
            typeof matched.name === "string" && matched.name
              ? matched.name
              : typeof matched.fieldKey === "string" && matched.fieldKey
                ? extractCustomValueKey(matched.fieldKey)
                : key;
          entry = { id: fuzzyId, displayName: matchedName };
        }
      }
    }

    if (!entry) {
      console.warn(
        `[GHL] Custom value key '${key}' not found in location ${locationId}. Skipping — will NOT create.`
      );
      return;
    }

    const url = `https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(entry.id)}`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify({ name: entry.displayName || key, value }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(
        `[GHL] PUT failed for custom value '${key}' (display name: '${entry.displayName}'): ${resp.status} ${errBody}`
      );
    }
  });

  await Promise.all(promises);
}

export async function upsertGhlCustomValue(
  locationId: string,
  name: string,
  value: string
): Promise<{ id: string; name: string; value: string }> {
  const accessToken = await getValidAccessToken(locationId);

  // Step 1: Fetch all existing custom values from the location
  let customValues: Record<string, unknown>[] = [];
  try {
    customValues = await fetchAllCustomValues(locationId, accessToken);
  } catch (err) {
    console.warn("[GHL] Failed pre-fetching custom values during update:", err);
  }

  // Step 2: Search for existing custom value ID by key, name, or aliases
  const nameAliases: string[] = [name];
  const normName = normalizeKey(name);
  if (normName.includes("leadfollowup")) {
    nameAliases.push("Lead Follow-up Options (Lite, SG-Link, Custom-Link)");
    nameAliases.push("lead_followup_options");
    nameAliases.push("lead_followup_option");
  }

  let existingId: string | undefined;
  for (const alias of nameAliases) {
    existingId = findCustomValueId(customValues, alias);
    if (existingId) break;
  }

  // Broad fuzzy fallback for lead follow-up custom value if still not found
  if (!existingId && normName.includes("leadfollowup")) {
    const leadCv = customValues.find(cv => {
      const cvName = String(
        cv.name || cv.key || cv.fieldKey || ""
      ).toLowerCase();
      return cvName.includes("lead") && cvName.includes("follow");
    });
    if (leadCv && typeof leadCv.id === "string") {
      existingId = leadCv.id;
    }
  }

  // Step 3: If no existing custom value ID is found in the sub-account, skip (NEVER POST)
  if (!existingId) {
    console.warn(
      `[GHL] Custom value '${name}' not found in sub-account location ${locationId}. Skipping PUT — will NOT create.`
    );
    return { id: "skipped_not_found", name, value };
  }

  // Step 4: Send PUT strictly to update the existing custom value
  const url = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(existingId)}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({ name, value }),
  });

  if (resp.ok) {
    const data = (await resp.json()) as Record<string, any>;
    const cv = data.customValue ?? data;
    return {
      id: existingId,
      name: typeof cv.name === "string" ? cv.name : name,
      value: typeof cv.value === "string" ? cv.value : value,
    };
  }

  const errBody = await resp.text();
  console.error(
    `[GHL] PUT failed for custom value '${name}': ${resp.status} ${errBody}`
  );
  return { id: existingId, name, value };
}

// ─── Token Exchange ──────────────────────────────────────────────────

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GHLTokenResponse> {
  const response = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ENV.ghlClientId,
      client_secret: ENV.ghlClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[GHL] Token exchange failed:", response.status, errorBody);
    throw new Error(`GHL token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<GHLTokenResponse>;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<GHLTokenResponse> {
  const response = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ENV.ghlClientId,
      client_secret: ENV.ghlClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[GHL] Token refresh failed:", response.status, errorBody);
    throw new Error(`GHL token refresh failed: ${response.status}`);
  }

  return response.json() as Promise<GHLTokenResponse>;
}

// ─── Installation Management ─────────────────────────────────────────

/**
 * Save or update a GHL installation after OAuth token exchange.
 * Company tokens are stored with locationId === companyId so they can be
 * looked up later via getAgencyInstallation(companyId).
 */
export async function upsertInstallation(
  tokenResponse: GHLTokenResponse,
  locationId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedLocationId = locationId.trim();
  const expiresAt =
    Date.now() + (Number(tokenResponse.expires_in) || 60 * 60 * 24) * 1000;
  const isCompanyToken =
    tokenResponse.userType === "Company" || !tokenResponse.locationId;
  const companyId =
    tokenResponse.companyId ?? (isCompanyToken ? normalizedLocationId : null);

  await db
    .insert(ghlInstallations)
    .values({
      locationId: normalizedLocationId,
      companyId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? tokenResponse.access_token,
      expiresAt,
      scopes: tokenResponse.scope ?? null,
      userId: tokenResponse.userId ?? null,
    })
    .onConflictDoUpdate({
      target: ghlInstallations.locationId,
      set: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token ?? tokenResponse.access_token,
        expiresAt,
        scopes: tokenResponse.scope ?? null,
        companyId,
        userId: tokenResponse.userId ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get an installation by exact locationId match.
 * Does NOT fallback to companyId — a location without its own token
 * should not accidentally use an agency token.
 */
export async function getInstallation(
  locationId: string
): Promise<GHLInstallation | undefined> {
  const normalizedLocationId = locationId.trim();
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(ghlInstallations)
    .where(eq(ghlInstallations.locationId, normalizedLocationId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get the agency (company-level) installation by companyId.
 * Company tokens are stored with locationId === companyId, so we
 * look up the row where locationId matches the companyId.
 */
export async function getAgencyInstallation(
  companyId: string
): Promise<GHLInstallation | undefined> {
  const normalizedCompanyId = companyId.trim();
  const db = await getDb();
  if (!db) return undefined;

  const companyMatch = await db
    .select()
    .from(ghlInstallations)
    .where(eq(ghlInstallations.locationId, normalizedCompanyId))
    .limit(1);

  if (companyMatch.length > 0) {
    return companyMatch[0];
  }

  return undefined;
}

/**
 * Remove an installation by locationId.
 * Called when GHL sends an UNINSTALL webhook event.
 */
export async function removeInstallation(locationId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .delete(ghlInstallations)
    .where(eq(ghlInstallations.locationId, locationId));
}

export async function getValidAccessToken(locationId: string): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  if (Date.now() + TOKEN_REFRESH_BUFFER_MS >= installation.expiresAt) {
    console.log(`[GHL] Refreshing token for location ${locationId}`);
    try {
      const newTokens = await refreshAccessToken(installation.refreshToken);
      await upsertInstallation(newTokens, locationId);
      return newTokens.access_token;
    } catch (error) {
      console.error(`[GHL] Failed to refresh token for ${locationId}:`, error);
      throw new Error(
        "Failed to refresh GHL access token. The app may need to be reinstalled."
      );
    }
  }

  return installation.accessToken;
}

export async function refreshInstallationAccessToken(
  locationId: string
): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  const newTokens = await refreshAccessToken(installation.refreshToken);
  await upsertInstallation(newTokens, locationId);
  return newTokens.access_token;
}

// ─── Install-Time Custom Value Seeding ───────────────────────────────

/**
 * After a location is successfully installed (token stored), seed default
 * custom values for the sub-account so that the Request Scheduling page
 * has sensible defaults on first load.
 */
export async function updateCustomValuesOnInstall(
  locationId: string
): Promise<void> {
  try {
    console.log(
      `[GHL Install] Starting custom value seeding for location: ${locationId}`
    );

    const accessToken = await getValidAccessToken(locationId);

    // Fetch location details to get the business name and owner first name
    const [locationResponse, businessResponse] = await Promise.all([
      fetch(`${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
      }),
      fetch(
        `${GHL_BASE_URL}/businesses/?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            Version: GHL_API_VERSION,
          },
        }
      ),
    ]);

    let locationName = "";
    let ownerFirstName = "";

    if (locationResponse.ok) {
      const data = (await locationResponse.json()) as any;
      const loc = data.location || data;
      locationName = loc.name || "";
      if (loc.prospectInfo && loc.prospectInfo.firstName) {
        ownerFirstName = loc.prospectInfo.firstName;
      } else if (loc.firstName) {
        ownerFirstName = loc.firstName;
      }
    }

    if (businessResponse.ok) {
      const data = (await businessResponse.json()) as any;
      if (data.businesses && data.businesses.length > 0) {
        locationName = data.businesses[0].name || locationName;
      }
    }

    console.log(
      `[GHL Install] Fetched details for location ${locationId}: Owner="${ownerFirstName}", Business="${locationName}"`
    );

    // Seed default custom values
    const customValuesToUpdate = [
      {
        name: "Lead Follow-up Options (Lite, SG-Link, Custom-Link)",
        value: "Lite",
      },
      { name: "Initial Outreach Scheduling", value: "24 Hours" },
      { name: "follow_up_limit", value: "3" },
    ];

    const updatePromises = customValuesToUpdate.map(cv =>
      upsertGhlCustomValue(locationId, cv.name, cv.value)
        .then(() =>
          console.log(
            `[GHL Install] Successfully updated custom value: "${cv.name}"`
          )
        )
        .catch(err =>
          console.error(
            `[GHL Install] Failed to update custom value "${cv.name}":`,
            err
          )
        )
    );

    await Promise.all(updatePromises);
    console.log(
      `[GHL Install] Finished seeding custom values for location: ${locationId}`
    );
  } catch (error) {
    console.error(
      `[GHL Install] Error seeding custom values for location ${locationId}:`,
      error
    );
    // Don't rethrow — a failure here should not crash the install process
  }
}

// ─── GHL API Calls ───────────────────────────────────────────────────

/**
 * Normalize a phone number for comparison.
 * Strips all non-digit characters so "(555) 123-4567" and "5551234567" match.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function createContact(
  locationId: string,
  contact: GHLContactData
): Promise<GHLCreateContactResponse> {
  const accessToken = await getValidAccessToken(locationId);

  // ── Step 1: Search for an existing contact by email or phone ──
  const query = (contact.email || contact.phone || "").trim();
  let existingContactId: string | null = null;

  if (query) {
    try {
      const searchResp = await fetch(`${GHL_BASE_URL}/contacts/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
        body: JSON.stringify({
          locationId,
          searchText: query,
          page: 1,
          limit: 1,
        }),
      });

      if (searchResp.ok) {
        const searchData = (await searchResp.json()) as Record<string, any>;
        const contacts = searchData.contacts || [];

        // Find an exact match by email or phone
        const exactMatch = contacts.find((c: any) => {
          const emailMatch =
            contact.email &&
            c.email &&
            c.email.toLowerCase() === contact.email.toLowerCase();
          const phoneMatch =
            contact.phone &&
            c.phone &&
            normalizePhone(c.phone) === normalizePhone(contact.phone);
          return emailMatch || phoneMatch;
        });

        if (exactMatch) {
          existingContactId = exactMatch.id;
          console.log(
            `[GHL DEBUG] Found existing contact by search: ${existingContactId} (${query})`
          );
        }
      }
    } catch (err) {
      console.warn(`[GHL] Failed to search for existing contact: ${err}`);
    }
  }

  // ── Step 2: If existing contact found, use v3 upsert endpoint; otherwise create new ──
  if (existingContactId) {
    const upsertPayload = {
      locationId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      address1: contact.address1 || undefined,
      city: contact.city || undefined,
      state: contact.state || undefined,
      postalCode: contact.postalCode || undefined,
      dnd: contact.dnd || false,
      source: "Royal Review - Add Contacts",
      customFields: contact.customFields
        ?.map(field => ({
          id: field.fieldKey,
          field_value: field.fieldValue,
        }))
        .filter(field => String(field.field_value ?? "").trim() !== ""),
    };

    console.log(
      "[GHL DEBUG] Upserting existing contact:",
      JSON.stringify(
        { contactId: existingContactId, ...upsertPayload },
        null,
        2
      )
    );

    // Use v3 upsert endpoint — requires Version: v3
    const upsertResp = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: "v3",
      },
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResp.ok) {
      const errorBody = await upsertResp.json().catch(() => ({}));
      const msg =
        (errorBody as Record<string, string>).message ||
        `Failed to upsert contact: ${upsertResp.status}`;
      console.error(`[GHL DEBUG] Upsert failed: ${msg}`);

      // Fallback: try PUT on the specific contact ID if upsert fails
      console.log("[GHL DEBUG] Falling back to PUT /contacts/{id}");
      const fallbackPayload = {
        firstName: contact.firstName,
        lastName: contact.lastName,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        address1: contact.address1 || undefined,
        city: contact.city || undefined,
        state: contact.state || undefined,
        postalCode: contact.postalCode || undefined,
        dnd: contact.dnd || false,
      };

      const putResp = await fetch(
        `${GHL_BASE_URL}/contacts/${existingContactId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            Version: GHL_API_VERSION,
          },
          body: JSON.stringify(fallbackPayload),
        }
      );

      if (!putResp.ok) {
        const putErrorBody = await putResp.json().catch(() => ({}));
        throw new Error(
          (putErrorBody as Record<string, string>).message ||
            `Failed to update contact: ${putResp.status}`
        );
      }

      const putResult = (await putResp.json()) as Record<string, any>;
      const updatedContact = putResult.contact || putResult;
      return {
        contact: {
          id: existingContactId,
          firstName: updatedContact.firstName || contact.firstName,
          lastName: updatedContact.lastName || contact.lastName,
          email: updatedContact.email || contact.email || "",
          phone: updatedContact.phone || contact.phone || "",
          locationId,
          dnd: contact.dnd || false,
        },
      };
    }

    const upsertResult = (await upsertResp.json()) as Record<string, any>;
    const upsertedContact = upsertResult.contact || upsertResult;
    return {
      contact: {
        id: existingContactId,
        firstName: upsertedContact.firstName || contact.firstName,
        lastName: upsertedContact.lastName || contact.lastName,
        email: upsertedContact.email || contact.email || "",
        phone: upsertedContact.phone || contact.phone || "",
        locationId,
        dnd: contact.dnd || false,
      },
    };
  }

  // ── Step 3: No existing contact found — create new via v3 upsert (also handles dedup) ──
  const createPayload = {
    locationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    address1: contact.address1 || undefined,
    city: contact.city || undefined,
    state: contact.state || undefined,
    postalCode: contact.postalCode || undefined,
    dnd: contact.dnd || false,
    source: "Royal Review - Add Contacts",
    customFields: contact.customFields
      ?.map(field => ({
        id: field.fieldKey,
        field_value: field.fieldValue,
      }))
      .filter(field => String(field.field_value ?? "").trim() !== ""),
  };

  console.log(
    "[GHL DEBUG] Creating new contact via upsert:",
    JSON.stringify(createPayload, null, 2)
  );

  // Use v3 upsert endpoint for both create and update — it handles dedup automatically
  const response = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: "v3",
    },
    body: JSON.stringify(createPayload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const msg =
      (errorBody as Record<string, string>).message ||
      `Failed to create contact: ${response.status}`;
    console.error(`[GHL DEBUG] Upsert create failed: ${msg}`);

    // Fallback to v1 POST if v3 upsert fails
    const v1Payload = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      address1: contact.address1 || undefined,
      city: contact.city || undefined,
      state: contact.state || undefined,
      postalCode: contact.postalCode || undefined,
      locationId,
      dnd: contact.dnd || false,
      source: "Royal Review - Add Contacts",
      tags: contact.tagName ? [contact.tagName] : undefined,
      customFields: contact.customFields
        ?.map(field => ({
          key: field.fieldKey,
          fieldValue: field.fieldValue,
        }))
        .filter(field => String(field.fieldValue ?? "").trim() !== ""),
    };

    const fallbackResp = await fetch(`${GHL_BASE_URL}/contacts/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(v1Payload),
    });

    if (!fallbackResp.ok) {
      const fallbackErrorBody = await fallbackResp.json().catch(() => ({}));
      throw new Error(
        (fallbackErrorBody as Record<string, string>).message ||
          `Failed to create contact: ${fallbackResp.status}`
      );
    }

    return fallbackResp.json() as Promise<GHLCreateContactResponse>;
  }

  const createResult = (await response.json()) as Record<string, any>;
  const createdContact = createResult.contact || createResult;
  return {
    contact: {
      id: createdContact.id || "",
      firstName: createdContact.firstName || contact.firstName,
      lastName: createdContact.lastName || contact.lastName,
      email: createdContact.email || contact.email || "",
      phone: createdContact.phone || contact.phone || "",
      locationId,
      dnd: contact.dnd || false,
    },
  };
}

export async function removeTagFromContact(
  locationId: string,
  contactId: string,
  tagName: string
): Promise<{ success: boolean }> {
  const accessToken = await getValidAccessToken(locationId);

  const encodedContactId = encodeURIComponent(contactId);
  console.log(
    `[GHL DEBUG] removeTagFromContact removing tag "${tagName}" from contact ${contactId}`
  );
  const deleteResp = await fetch(
    `${GHL_BASE_URL}/contacts/${encodedContactId}/tags`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify({ tags: [tagName] }),
    }
  );

  if (deleteResp.ok) {
    console.log(
      `[GHL DEBUG] removeTagFromContact succeeded for tag "${tagName}" on contact ${contactId}`
    );
    return { success: true };
  }

  const deleteBody = await deleteResp.text().catch(() => "");
  console.warn(
    `[GHL DEBUG] removeTagFromContact DELETE /contacts/${encodedContactId}/tags failed: ${deleteResp.status} ${deleteBody}`
  );

  // Fallback: fetch the contact, remove the tag locally, then update the contact with the remaining tag list.
  const getResp = await fetch(`${GHL_BASE_URL}/contacts/${encodedContactId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
  });

  if (!getResp.ok) {
    const body = await getResp.text().catch(() => "");
    throw new Error(
      `Failed to fetch contact ${contactId} for tag removal: ${getResp.status} ${body}`
    );
  }

  const contactData = (await getResp.json()) as Record<string, any>;
  const rawContact = contactData.contact || contactData;
  const currentTags: string[] = Array.isArray(rawContact.tags)
    ? rawContact.tags.map((t: any) =>
        typeof t === "string" ? t : t?.name || t?.tagName || ""
      )
    : [];

  const normalizedTag = tagName.toLowerCase().trim();
  const remainingTags = currentTags.filter(
    tag => tag.toLowerCase().trim() !== normalizedTag
  );

  if (remainingTags.length === currentTags.length) {
    // Tag was not present, so treat as successful removal.
    console.log(
      `[GHL DEBUG] removeTagFromContact tag "${tagName}" was not present on contact ${contactId}, no update needed.`
    );
    return { success: true };
  }

  console.log(
    `[GHL DEBUG] removeTagFromContact falling back to PUT /contacts/${encodedContactId} to remove tag "${tagName}" from contact ${contactId}`
  );

  const updatePayload: Record<string, unknown> = {
    firstName: rawContact.firstName || undefined,
    lastName: rawContact.lastName || undefined,
    name:
      rawContact.name ||
      `${rawContact.firstName || ""} ${rawContact.lastName || ""}`.trim() ||
      undefined,
    email: rawContact.email || undefined,
    phone: rawContact.phone || undefined,
    tags: remainingTags,
  };

  const updateResp = await fetch(
    `${GHL_BASE_URL}/contacts/${encodedContactId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(updatePayload),
    }
  );

  if (updateResp.ok) {
    return { success: true };
  }

  const updateBody = await updateResp.text().catch(() => "");
  throw new Error(
    `Failed to remove tag ${tagName} from contact ${contactId}: ${updateResp.status} ${updateBody}`
  );
}

export async function addTagToContact(
  locationId: string,
  contactId: string,
  tagName: string
): Promise<{ success: boolean }> {
  console.log(
    `[GHL DEBUG] addTagToContact called with tagName: "${tagName}" for contact: ${contactId}`
  );
  const accessToken = await getValidAccessToken(locationId);
  const attempts: Array<{ url: string; method?: string; body?: unknown }> = [
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}/tags`,
      method: "POST",
      body: { tags: [tagName] },
    },
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}/tag`,
      method: "POST",
      body: { tag: tagName },
    },
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}`,
      method: "PATCH",
      body: { tags: [tagName] },
    },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: attempt.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
      });

      if (response.ok) {
        console.log(
          `[GHL DEBUG] addTagToContact SUCCESS via ${attempt.url} with tag: "${tagName}"`
        );
        return { success: true };
      }
      const body = await response.text().catch(() => "");
      lastError = `${response.status} ${body} (${attempt.url})`;
      console.log(`[GHL DEBUG] addTagToContact attempt FAILED: ${lastError}`);

      if (response.status !== 404 && response.status !== 405) break;
    } catch (err: any) {
      lastError = String(err?.message ?? err);
    }
  }

  try {
    const createResp = await fetch(`${GHL_BASE_URL}/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify({ name: tagName, locationId }),
    });

    if (createResp.ok) {
      const created = await createResp.json().catch(() => ({}) as any);
      const tagId = (created && (created.id || created.tagId)) || undefined;
      if (tagId) {
        const attachResp = await fetch(
          `${GHL_BASE_URL}/contacts/${contactId}/tags/${tagId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              Version: GHL_API_VERSION,
            },
          }
        );

        if (attachResp.ok) return { success: true };
        const body = await attachResp.text().catch(() => "");
        lastError = `${attachResp.status} ${body} (attach by id)`;
      }
    } else {
      const body = await createResp.text().catch(() => "");
      lastError = `${createResp.status} ${body} (create tag)`;
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err);
  }

  throw new Error(
    lastError || `Failed to add tag ${tagName} to contact ${contactId}`
  );
}

export async function processContact(
  locationId: string,
  contact: GHLContactData
): Promise<{ contactId: string; enrolledInWorkflow: boolean }> {
  console.log(
    `[GHL DEBUG] processContact received tagName: "${contact.tagName}" customFields: ${JSON.stringify(contact.customFields)}`
  );
  const result = await createContact(locationId, contact);
  const contactId = result.contact.id;

  const triggerTag = process.env.GHL_TRIGGER_TAG ?? "royal_review_personalizer";
  let enrolledInWorkflow = false;

  if (!contact.dnd) {
    if (contact.tagName) {
      const completedTag = getCompletedTagForActive(contact.tagName);
      if (completedTag) {
        try {
          await removeTagFromContact(locationId, contactId, completedTag);
        } catch (error) {
          console.warn(
            `[GHL] Failed to remove completed tag ${completedTag} before adding ${contact.tagName} for contact ${contactId}:`,
            error
          );
        }
      }

      try {
        await addTagToContact(locationId, contactId, contact.tagName);
      } catch (error) {
        console.warn(
          `[GHL] Failed to add selected tag to contact ${contactId}:`,
          error
        );
      }
    }

    try {
      await addTagToContact(locationId, contactId, triggerTag);
    } catch (error) {
      console.warn(
        `[GHL] Failed to add trigger tag to contact ${contactId}:`,
        error
      );
    }
  }

  return { contactId, enrolledInWorkflow };
}

// ─── GHL Custom Variable & Field Picker Metadata ─────────────────────

const GHL_PICKER_API_VERSION = "v3";

export type PickerVariable = {
  id: string;
  source: "custom_value" | "contact_custom_field";
  name: string;
  fieldKey: string;
  token: string;
  dataType?: string;
};

export type PickerVariablesResult = {
  items: PickerVariable[];
  sourceStatus: {
    customValues: "success" | "error";
    contactCustomFields: "success" | "error";
  };
};

/**
 * Normalizes a raw Custom Value fieldKey into standard GHL merge-token format.
 * Examples:
 * - "{{custom_values.office_phone}}" -> "{{custom_values.office_phone}}"
 * - "custom_values.office_phone"     -> "{{custom_values.office_phone}}"
 * - "office_phone"                   -> "{{custom_values.office_phone}}"
 */
export function normalizeCustomValueToken(rawKey: string): string | null {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
    return null;
  }

  let cleaned = rawKey.trim();
  if (cleaned.startsWith("{{") && cleaned.endsWith("}}")) {
    cleaned = cleaned.slice(2, -2).trim();
  }

  if (cleaned.startsWith("custom_values.")) {
    const keyPart = cleaned.slice("custom_values.".length).trim();
    if (!keyPart) return null;
    return `{{custom_values.${keyPart}}}`;
  }

  if (!cleaned) return null;
  return `{{custom_values.${cleaned}}}`;
}

/**
 * Normalizes a raw Contact Custom Field fieldKey into standard GHL merge-token format.
 * Examples:
 * - "contact.dog_count"     -> "{{contact.dog_count}}"
 * - "dog_count"             -> "{{contact.dog_count}}"
 * - "{{contact.dog_count}}" -> "{{contact.dog_count}}"
 */
export function normalizeContactFieldToken(rawKey: string): string | null {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
    return null;
  }

  let cleaned = rawKey.trim();
  if (cleaned.startsWith("{{") && cleaned.endsWith("}}")) {
    cleaned = cleaned.slice(2, -2).trim();
  }

  if (cleaned.startsWith("contact.")) {
    const keyPart = cleaned.slice("contact.".length).trim();
    if (!keyPart) return null;
    return `{{contact.${keyPart}}}`;
  }

  if (!cleaned) return null;
  return `{{contact.${cleaned}}}`;
}

/**
 * Fetches and normalizes live GHL Custom Values and Contact Custom Fields for a location.
 * Uses GHL API Version v3 for metadata list calls.
 * Performs requests in parallel with Promise.allSettled.
 * Does NOT return custom value contents or sensitive secrets to the client.
 */
export async function getLocationPickerVariables(
  locationId: string
): Promise<PickerVariablesResult> {
  const accessToken = await getValidAccessToken(locationId);

  const customValuesUrl = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`;
  const customFieldsUrlPrimary = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/custom-fields`;
  const customFieldsUrlSecondary = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customFields?model=contact`;

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
  };

  const [customValuesRes, customFieldsResPrimary, customFieldsResSecondary] = await Promise.allSettled([
    fetch(customValuesUrl, { method: "GET", headers }),
    fetch(customFieldsUrlPrimary, { method: "GET", headers }),
    fetch(customFieldsUrlSecondary, { method: "GET", headers: { ...headers, Version: "v3" } }),
  ]);

  const items: PickerVariable[] = [];
  let cvStatus: "success" | "error" = "error";
  let cfStatus: "success" | "error" = "error";

  // 1. Process Custom Values
  if (customValuesRes.status === "fulfilled" && customValuesRes.value.ok) {
    try {
      const data = (await customValuesRes.value.json()) as Record<string, unknown>;
      const rawValues = (data.customValues || data.custom_values || (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
      if (Array.isArray(rawValues)) {
        cvStatus = "success";
        for (const cv of rawValues) {
          const rawKey = typeof cv.fieldKey === "string" && cv.fieldKey.trim()
            ? cv.fieldKey
            : typeof cv.key === "string" && cv.key.trim()
              ? cv.key
              : typeof cv.name === "string" && cv.name.trim()
                ? cv.name
                : "";

          if (!rawKey) continue;

          const token = normalizeCustomValueToken(rawKey);
          if (!token) continue;

          const id = typeof cv.id === "string" && cv.id ? cv.id : typeof cv._id === "string" ? cv._id : token;
          const name = typeof cv.name === "string" && cv.name.trim() ? cv.name.trim() : rawKey;

          items.push({
            id: `cv_${id}`,
            source: "custom_value",
            name,
            fieldKey: rawKey,
            token,
          });
        }
      }
    } catch (e) {
      console.warn("[GHL Picker] Failed parsing Custom Values response:", e);
    }
  }

  // 2. Process Contact Custom Fields (Primary or Secondary)
  const activeFieldsRes = customFieldsResPrimary.status === "fulfilled" && customFieldsResPrimary.value.ok
    ? customFieldsResPrimary.value
    : customFieldsResSecondary.status === "fulfilled" && customFieldsResSecondary.value.ok
      ? customFieldsResSecondary.value
      : null;

  if (activeFieldsRes) {
    try {
      const data = (await activeFieldsRes.json()) as Record<string, unknown>;
      const rawFields = (data.customFields || data.custom_fields || data.fields || (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
      if (Array.isArray(rawFields)) {
        cfStatus = "success";
        for (const cf of rawFields) {
          const rawKey = typeof cf.fieldKey === "string" && cf.fieldKey.trim()
            ? cf.fieldKey
            : typeof cf.key === "string" && cf.key.trim()
              ? cf.key
              : typeof cf.name === "string" && cf.name.trim()
                ? cf.name
                : "";

          if (!rawKey) continue;

          const token = normalizeContactFieldToken(rawKey);
          if (!token) continue;

          const id = typeof cf.id === "string" && cf.id ? cf.id : typeof cf._id === "string" ? cf._id : token;
          const name = typeof cf.name === "string" && cf.name.trim()
            ? cf.name.trim()
            : typeof cf.displayName === "string" && cf.displayName.trim()
              ? cf.displayName.trim()
              : rawKey;

          const dataType = typeof cf.dataType === "string" && cf.dataType
            ? cf.dataType
            : typeof cf.fieldType === "string" && cf.fieldType
              ? cf.fieldType
              : undefined;

          items.push({
            id: `cf_${id}`,
            source: "contact_custom_field",
            name,
            fieldKey: rawKey,
            token,
            dataType,
          });
        }
      }
    } catch (e) {
      console.warn("[GHL Picker] Failed parsing Contact Custom Fields response:", e);
    }
  }

  // 3. Deduplicate items by source + ":" + token
  const seen = new Set<string>();
  const deduplicated: PickerVariable[] = [];

  for (const item of items) {
    const dedupKey = `${item.source}:${item.token}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      deduplicated.push(item);
    }
  }

  // 5. Sort: first by source ("custom_value" before "contact_custom_field"), then by name (localeCompare)
  deduplicated.sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === "custom_value" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return {
    items: deduplicated,
    sourceStatus: {
      customValues: cvStatus,
      contactCustomFields: cfStatus,
    },
  };
}
