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
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { ghlInstallations, type GHLInstallation } from "../drizzle/schema";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
// Refresh tokens 10 minutes before they expire
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

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
  const normalize = (value: string) => value.toLowerCase().replace(/[\s-]/g, "_");
  return normalize(apiKey) === normalize(configKey) || normalize(apiKey) === `contact.${normalize(configKey)}` || apiKey === configKey;
}

function getCustomValueMap(customValues: Record<string, unknown>[]): Map<string, { id: string; value: string }> {
  const map = new Map<string, { id: string; value: string }>();

  for (const customValue of customValues) {
    const key = typeof customValue.fieldKey === "string" ? customValue.fieldKey : typeof customValue.name === "string" ? customValue.name : "";
    const id = typeof customValue.id === "string" ? customValue.id : "";
    const value = typeof customValue.value === "string" ? customValue.value : "";

    if (!key || !id) continue;
    map.set(key, { id, value });
  }

  return map;
}

export async function getLocationCustomValueMap(locationId: string): Promise<Map<string, { id: string; value: string }>> {
  const { accessToken } = await getAccessTokenAndInstallation(locationId);
  const response = await fetchJson<{ customValues?: Record<string, unknown>[] }>(
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

async function fetchJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
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
    console.error(`[GHL] Failed to fetch custom fields: ${response.status} ${errorBody}`);
    return [];
  }

  const data = (await response.json()) as Record<string, any>;
  const fieldsArray = (Array.isArray(data.customFields) ? data.customFields : data.fields ?? []) as any[];

  return fieldsArray
    .filter((field: any): field is Record<string, unknown> => !!field && typeof field === "object")
    .map((field: Record<string, any>) => ({
      id: typeof field.id === "string" ? field.id : "",
      fieldKey: typeof field.fieldKey === "string" ? field.fieldKey : typeof field.name === "string" ? field.name : "",
      displayName: typeof field.displayName === "string" ? field.displayName : typeof field.name === "string" ? field.name : "",
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
    console.error(`[GHL] Error discovering custom field "${fieldNamePattern}":`, error);
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

export async function upsertGhlCustomValue(
  locationId: string,
  name: string,
  value: string
): Promise<{ id: string; name: string; value: string }> {
  const accessToken = await getValidAccessToken(locationId);

  const getResponse = await fetch(
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

  if (!getResponse.ok) {
    const errorBody = await getResponse.text();
    console.error(`[GHL] Failed to fetch custom values: ${getResponse.status} ${errorBody}`);
    throw new Error(`Failed to fetch custom values: ${getResponse.status}`);
  }

  const data = (await getResponse.json()) as { customValues?: Record<string, unknown>[] };
  const customValues = data.customValues ?? [];

  let existingId: string | undefined;
  const normalizedTarget = normalizeFieldName(name);
  for (const customValue of customValues) {
    const keyCandidates = [
      typeof customValue.fieldKey === "string" ? customValue.fieldKey : undefined,
      typeof customValue.key === "string" ? customValue.key : undefined,
      typeof customValue.name === "string" ? customValue.name : undefined,
    ].filter(Boolean) as string[];

    for (const candidate of keyCandidates) {
      if (normalizeFieldName(candidate) === normalizedTarget || candidate === name) {
        existingId = typeof customValue.id === "string" ? customValue.id : undefined;
        break;
      }
    }

    if (existingId) break;
  }

  const url = existingId
    ? `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(existingId)}`
    : `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`;

  const method = existingId ? "PUT" : "POST";
  const payload: Record<string, unknown> = { name, value };

  const upsertResponse = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!upsertResponse.ok) {
    const errorBody = await upsertResponse.text();
    console.error(`[GHL] Failed to upsert custom value "${name}":`, {
      status: upsertResponse.status,
      method,
      url,
      payload,
      errorBody,
    });
    throw new Error(`Failed to save custom value "${name}": ${upsertResponse.status} ${errorBody}`);
  }

  const upsertData = (await upsertResponse.json()) as Record<string, any>;
  const customValue = upsertData.customValue ?? upsertData;

  return {
    id: typeof customValue.id === "string" ? customValue.id : existingId ?? "",
    name: typeof customValue.name === "string" ? customValue.name : name,
    value: typeof customValue.value === "string" ? customValue.value : value,
  };
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
  const expiresAt = Date.now() + (Number(tokenResponse.expires_in) || 60 * 60 * 24) * 1000;
  const isCompanyToken = tokenResponse.userType === "Company" || !tokenResponse.locationId;
  const companyId = tokenResponse.companyId ?? (isCompanyToken ? normalizedLocationId : null);

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

  await db.delete(ghlInstallations).where(eq(ghlInstallations.locationId, locationId));
}

export async function getValidAccessToken(
  locationId: string
): Promise<string> {
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
      throw new Error("Failed to refresh GHL access token. The app may need to be reinstalled.");
    }
  }

  return installation.accessToken;
}

export async function refreshInstallationAccessToken(locationId: string): Promise<string> {
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
export async function updateCustomValuesOnInstall(locationId: string): Promise<void> {
  try {
    console.log(`[GHL Install] Starting custom value seeding for location: ${locationId}`);

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
      fetch(`${GHL_BASE_URL}/businesses/?locationId=${encodeURIComponent(locationId)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
      }),
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

    console.log(`[GHL Install] Fetched details for location ${locationId}: Owner="${ownerFirstName}", Business="${locationName}"`);

    // Seed default custom values
    const customValuesToUpdate = [
      { name: "Lead Follow-up Options (Lite, SG-Link, Custom-Link)", value: "Lite" },
      { name: "Initial Outreach Scheduling", value: "24 Hours" },
      { name: "follow_up_limit", value: "3" },
    ];

    const updatePromises = customValuesToUpdate.map((cv) =>
      upsertGhlCustomValue(locationId, cv.name, cv.value)
        .then(() => console.log(`[GHL Install] Successfully updated custom value: "${cv.name}"`))
        .catch((err) => console.error(`[GHL Install] Failed to update custom value "${cv.name}":`, err))
    );

    await Promise.all(updatePromises);
    console.log(`[GHL Install] Finished seeding custom values for location: ${locationId}`);
  } catch (error) {
    console.error(`[GHL Install] Error seeding custom values for location ${locationId}:`, error);
    // Don't rethrow — a failure here should not crash the install process
  }
}

// ─── GHL API Calls ───────────────────────────────────────────────────

export async function createContact(
  locationId: string,
  contact: GHLContactData
): Promise<GHLCreateContactResponse> {
  const accessToken = await getValidAccessToken(locationId);

  const ghlPayload = {
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
      ?.map((field) => ({
        key: field.fieldKey,
        fieldValue: field.fieldValue,
      }))
      .filter((field) => String(field.fieldValue ?? "").trim() !== ""),
  };

  console.log("[GHL DEBUG] createContact payload:", JSON.stringify(ghlPayload, null, 2));

  const response = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
      body: JSON.stringify(ghlPayload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      (errorBody as Record<string, string>).message ||
        `Failed to create contact: ${response.status}`
    );
  }

  return response.json() as Promise<GHLCreateContactResponse>;
}

export async function addTagToContact(
  locationId: string,
  contactId: string,
  tagName: string
): Promise<{ success: boolean }> {
  console.log(`[GHL DEBUG] addTagToContact called with tagName: "${tagName}" for contact: ${contactId}`);
  const accessToken = await getValidAccessToken(locationId);
  const attempts: Array<{ url: string; method?: string; body?: unknown }> = [
    { url: `${GHL_BASE_URL}/contacts/${contactId}/tags`, method: "POST", body: { tags: [tagName] } },
    { url: `${GHL_BASE_URL}/contacts/${contactId}/tag`, method: "POST", body: { tag: tagName } },
    { url: `${GHL_BASE_URL}/contacts/${contactId}`, method: "PATCH", body: { tags: [tagName] } },
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
        console.log(`[GHL DEBUG] addTagToContact SUCCESS via ${attempt.url} with tag: "${tagName}"`);
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
      const created = await createResp.json().catch(() => ({} as any));
      const tagId = (created && (created.id || created.tagId)) || undefined;
      if (tagId) {
        const attachResp = await fetch(`${GHL_BASE_URL}/contacts/${contactId}/tags/${tagId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            Version: GHL_API_VERSION,
          },
        });

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

  throw new Error(lastError || `Failed to add tag ${tagName} to contact ${contactId}`);
}

export async function processContact(
  locationId: string,
  contact: GHLContactData
): Promise<{ contactId: string; enrolledInWorkflow: boolean }> {
  console.log(`[GHL DEBUG] processContact received tagName: "${contact.tagName}" customFields: ${JSON.stringify(contact.customFields)}`);
  const result = await createContact(locationId, contact);
  const contactId = result.contact.id;

  const triggerTag = process.env.GHL_TRIGGER_TAG ?? "royal_review_personalizer";
  let enrolledInWorkflow = false;

  if (!contact.dnd) {
    if (contact.tagName) {
      try {
        await addTagToContact(locationId, contactId, contact.tagName);
      } catch (error) {
        console.warn(`[GHL] Failed to add selected tag to contact ${contactId}:`, error);
      }
    }

    try {
      await addTagToContact(locationId, contactId, triggerTag);
    } catch (error) {
      console.warn(`[GHL] Failed to add trigger tag to contact ${contactId}:`, error);
    }
  }

  return { contactId, enrolledInWorkflow };
}
