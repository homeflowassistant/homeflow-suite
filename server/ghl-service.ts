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
import { ghlInstallations, type GHLInstallation } from "../drizzle/schema";
import { ENV } from "./_core/env";

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
  dnd?: boolean;
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

export type GHLContactStatusFilter = "stopped" | "clicked" | "dnc";

export interface GHLListedContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  smsStatus: "Follow up" | "Clicked" | "Do Not Contact" | "Finished";
  emailStatus: "Follow up" | "Clicked" | "Do Not Contact" | "Finished";
  dateAdded: string;
}

export interface GHLContactsPage {
  contacts: GHLListedContact[];
  pagination: {
    total: number;
    searchAfter: string[] | null;
    pageLimit: number;
  };
}

export interface GHLMessagingContext {
  ownerFirstName: string;
  ownerLastName: string;
  businessName: string;
  businessId: string;
  companyId: string;
  personalizedImageBaseUrl: string;
  customMessage: string;
  personalizedImageEnabled: boolean;
  personalizedImageUrl: string;
}

export interface GHLSearchContactsOptions {
  query?: string;
  pageLimit?: number;
  searchAfter?: string[];
  statusFilters?: GHLContactStatusFilter[];
}

export interface GHLWorkflowSummary {
  id: string;
  name: string;
  status: string;
}

const REVIEW_WORKFLOW_NAMES = ["01. Review Reactivation", "02. Review Request"];
const MESSAGING_CUSTOM_KEYS = {
  personalizedImageBaseUrl: "nifty_personalized_image_url",
  customMessage: "review_request_message",
  personalizedImageEnabled: "personalized_image_enabled",
} as const;

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

async function fetchMaybeJson(url: string, accessToken: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
  });

  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return [record.id, record.name, record.title, record.label, record.workflowId]
          .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
      }
      return [];
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getContactTags(contact: Record<string, unknown>): string[] {
  return toStringArray(contact.tags ?? contact.tagIds ?? contact.tagNames);
}

function getContactWorkflows(contact: Record<string, unknown>, field: "activeWorkflows" | "finishedWorkflows"): string[] {
  return toStringArray(contact[field]);
}

function hasClickedTag(tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === "clicked");
}

function hasReviewWorkflow(workflows: string[]): boolean {
  return workflows.some((workflow) => {
    const normalized = workflow.toLowerCase();
    return REVIEW_WORKFLOW_NAMES.some((name) => {
      const lower = name.toLowerCase();
      return normalized === lower || normalized.includes(lower);
    });
  });
}

function determineContactStatus(contact: Record<string, unknown>): GHLListedContact["smsStatus"] {
  // Check DND first
  const dnd = Boolean(contact.dnd);
  if (dnd) return "Do Not Contact";

  // Check tags using normalized comparison
  const rawTags = contact.tags ?? [];
  if (!Array.isArray(rawTags)) {
    // If no tags, return Finished as default
    return "Finished";
  }

  const normalizedTags = rawTags
    .map((tag) => {
      if (typeof tag === "string") return tag.toLowerCase().trim();
      if (tag && typeof tag === "object") {
        const name = (tag as Record<string, unknown>).name ?? (tag as Record<string, unknown>).tag ?? "";
        return String(name).toLowerCase().trim();
      }
      return "";
    })
    .filter(Boolean);

  // Check for active workflow tags (highest priority after DND)
  const hasActiveReviewTag = normalizedTags.some(
    (tag) =>
      tag === "review_reactivation_active" ||
      tag === "review_request_active"
  );
  if (hasActiveReviewTag) return "Follow up";

  // Check for finished workflow tags
  const hasFinishedReviewTag = normalizedTags.some(
    (tag) =>
      tag === "review_reactivation_finished" ||
      tag === "review_request_finished"
  );
  if (hasFinishedReviewTag) return "Finished";

  // Check for "clicked" tag for backward compatibility
  const hasClickedTag = normalizedTags.some((tag) => tag === "clicked");
  if (hasClickedTag) return "Clicked";

  // Default to Finished
  return "Finished";
}

function normalizeContact(contact: Record<string, unknown>): GHLListedContact {
  const firstName = typeof contact.firstName === "string" ? contact.firstName : "";
  const lastName = typeof contact.lastName === "string" ? contact.lastName : "";
  const name = typeof contact.name === "string" && contact.name.trim().length > 0
    ? contact.name.trim()
    : `${firstName} ${lastName}`.trim() || "Unnamed contact";

  const dateAddedValue = contact.dateAdded ?? contact.createdAt ?? contact.dateCreated ?? contact.created_at;

  return {
    id: typeof contact.id === "string" ? contact.id : crypto.randomUUID(),
    name,
    phone: typeof contact.phone === "string" ? contact.phone : "",
    email: typeof contact.email === "string" ? contact.email : "",
    smsStatus: determineContactStatus(contact),
    emailStatus: determineContactStatus(contact),
    dateAdded:
      typeof dateAddedValue === "string"
        ? dateAddedValue
        : typeof dateAddedValue === "number"
          ? new Date(dateAddedValue).toISOString()
          : new Date().toISOString(),
  };
}

function extractSearchResponse(body: unknown): { contacts: Record<string, unknown>[]; total: number; searchAfter: string[] | null } {
  if (!body || typeof body !== "object") {
    return { contacts: [], total: 0, searchAfter: null };
  }

  const record = body as Record<string, unknown>;
  const contactsCandidate = record.contacts ?? record.data ?? record.items ?? record.results ?? [];
  const contacts = Array.isArray(contactsCandidate)
    ? contactsCandidate.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

  const totalCandidate = record.total ?? record.totalCount ?? record.paginationTotal ?? record.meta;
  const total =
    typeof totalCandidate === "number"
      ? totalCandidate
      : typeof totalCandidate === "object" && totalCandidate !== null && typeof (totalCandidate as Record<string, unknown>).total === "number"
        ? (totalCandidate as Record<string, unknown>).total as number
        : contacts.length;

  const searchAfterCandidate = record.searchAfter ?? record.nextSearchAfter ?? record.nextCursor;
  const searchAfter = Array.isArray(searchAfterCandidate)
    ? searchAfterCandidate.filter((entry): entry is string => typeof entry === "string")
    : null;

  return { contacts, total, searchAfter };
}

function extractWorkflowResponse(body: unknown): GHLWorkflowSummary[] {
  if (!body || typeof body !== "object") return [];

  const record = body as Record<string, unknown>;
  const workflowsCandidate = record.workflows ?? record.data ?? record.items ?? record.results ?? [];
  const workflows = Array.isArray(workflowsCandidate)
    ? workflowsCandidate.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

  return workflows
    .map((workflow) => {
      const id = typeof workflow.id === "string" ? workflow.id : typeof workflow.workflowId === "string" ? workflow.workflowId : "";
      const name = typeof workflow.name === "string" ? workflow.name : typeof workflow.title === "string" ? workflow.title : "Unnamed workflow";
      const status = typeof workflow.status === "string" ? workflow.status : typeof workflow.active === "boolean" ? (workflow.active ? "active" : "inactive") : "unknown";
      return { id, name, status };
    })
    .filter((workflow) => workflow.id.length > 0);
}

export async function searchContacts(
  locationId: string,
  options: GHLSearchContactsOptions = {}
): Promise<GHLContactsPage> {
  const accessToken = await getValidAccessToken(locationId);
  const pageLimit = options.pageLimit ?? 50;

  const payload: Record<string, unknown> = {
    locationId,
    pageLimit,
  };

  if (options.query && options.query.trim().length > 0) {
    payload.query = options.query.trim();
  }

  if (options.searchAfter && options.searchAfter.length > 0) {
    payload.searchAfter = options.searchAfter;
  }

  const response = await fetch(`${GHL_BASE_URL}/contacts/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to search contacts: ${response.status} ${errorBody}`);
  }

  const body = await response.json().catch(() => ({}));
  const { contacts, total, searchAfter } = extractSearchResponse(body);
  const normalized = contacts.map(normalizeContact);

  const filtered = options.statusFilters && options.statusFilters.length > 0
    ? normalized.filter((contact) => {
        const matchedFilters = new Set(options.statusFilters);

        return (
          (matchedFilters.has("clicked") && contact.smsStatus === "Clicked") ||
          (matchedFilters.has("dnc") && contact.smsStatus === "Do Not Contact") ||
          (matchedFilters.has("stopped") && contact.smsStatus === "Finished")
        );
      })
    : normalized;

  return {
    contacts: filtered,
    pagination: {
      total: options.statusFilters && options.statusFilters.length > 0 ? filtered.length : total,
      searchAfter,
      pageLimit,
    },
  };
}

// ─── Pipelines & Opportunities (Tag-Based Status) ──────────────────

/**
 * Fetch pipelines for a location.
 * Used to find the Review pipeline ID dynamically.
 */
export async function getPipelines(
  locationId: string
): Promise<Array<{ id: string; name: string }>> {
  const accessToken = await getValidAccessToken(locationId);

  const response = await fetch(`${GHL_BASE_URL}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[GHL] Failed to fetch pipelines: ${response.status} ${errorBody}`);
    return [];
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const pipelinesArray = Array.isArray(body.pipelines)
    ? body.pipelines
    : Array.isArray(body.data)
      ? body.data
      : [];

  return pipelinesArray
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((pipeline) => ({
      id: typeof pipeline.id === "string" ? pipeline.id : "",
      name: typeof pipeline.name === "string" ? pipeline.name : "",
    }))
    .filter((p) => p.id && p.name);
}

/**
 * Search opportunities for a contact in a specific pipeline with a given status.
 * Returns true if at least one matching opportunity exists.
 */
export async function hasOpportunityInStatus(
  locationId: string,
  contactId: string,
  pipelineId: string,
  status: string
): Promise<boolean> {
  const accessToken = await getValidAccessToken(locationId);

  const response = await fetch(
    `${GHL_BASE_URL}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}&pipeline_id=${encodeURIComponent(pipelineId)}&status=${encodeURIComponent(status)}`,
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
      `[GHL] Failed to search opportunities for contact ${contactId}: ${response.status} ${errorBody}`
    );
    return false;
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunities = Array.isArray(body.opportunities)
    ? body.opportunities
    : Array.isArray(body.data)
      ? body.data
      : [];

  return Array.isArray(opportunities) && opportunities.length > 0;
}

export async function getMessagingContext(locationId: string): Promise<GHLMessagingContext> {
  const { accessToken } = await getAccessTokenAndInstallation(locationId);

  const [locationResponse, businessesResponse, customValuesResponse] = await Promise.all([
    fetchJson<Record<string, unknown> | { location?: Record<string, unknown> }>(
      `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}`,
      accessToken,
      { method: "GET" }
    ),
    fetchJson<{ businesses?: Record<string, unknown>[] }>(
      `${GHL_BASE_URL}/businesses/?locationId=${encodeURIComponent(locationId)}`,
      accessToken,
      { method: "GET" }
    ),
    fetchJson<{ customValues?: Record<string, unknown>[] }>(
      `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`,
      accessToken,
      { method: "GET" }
    ),
  ]);

  const location = "location" in locationResponse ? locationResponse.location ?? {} : locationResponse;
  const business = businessesResponse.businesses?.[0] ?? {};
  const customValues = customValuesResponse.customValues ?? [];
  const customValueMap = getCustomValueMap(customValues);

  const getCustomValue = (key: string) => {
    for (const [apiKey, entry] of customValueMap.entries()) {
      if (matchesCustomKey(apiKey, key)) return entry.value;
    }
    return "";
  };

  const ownerFirstName = typeof (location.prospectInfo as Record<string, unknown> | undefined)?.firstName === "string"
    ? String((location.prospectInfo as Record<string, unknown>).firstName)
    : typeof location.firstName === "string"
      ? String(location.firstName)
      : "";

  const ownerLastName = typeof (location.prospectInfo as Record<string, unknown> | undefined)?.lastName === "string"
    ? String((location.prospectInfo as Record<string, unknown>).lastName)
    : typeof location.lastName === "string"
      ? String(location.lastName)
      : "";

  const businessName = typeof business.name === "string" ? business.name : "";

  return {
    ownerFirstName,
    ownerLastName,
    businessName,
    businessId: typeof business.id === "string" ? business.id : "",
    companyId: typeof location.companyId === "string" ? location.companyId : "",
    personalizedImageBaseUrl: getCustomValue(MESSAGING_CUSTOM_KEYS.personalizedImageBaseUrl),
    customMessage: getCustomValue(MESSAGING_CUSTOM_KEYS.customMessage),
    personalizedImageEnabled: (() => {
      const value = getCustomValue(MESSAGING_CUSTOM_KEYS.personalizedImageEnabled);
      return value === "true" || value === "1";
    })(),
    personalizedImageUrl: "",
  };
}

export async function updateMessagingSettings(
  locationId: string,
  input: {
    ownerFirstName: string;
    ownerLastName?: string;
    businessName: string;
    businessId?: string;
    companyId?: string;
    customMessage: string;
    personalizedImageEnabled: boolean;
    personalizedImageBaseUrl: string;
  }
): Promise<void> {
  const { accessToken } = await getAccessTokenAndInstallation(locationId);

  const context = await getMessagingContext(locationId);
  const nextBusinessId = input.businessId || context.businessId;

  if (input.ownerFirstName !== context.ownerFirstName || (input.ownerLastName ?? "") !== context.ownerLastName) {
    const locationBody: Record<string, unknown> = {
      prospectInfo: {
        firstName: input.ownerFirstName,
        lastName: input.ownerLastName ?? "",
      },
    };

    if (input.companyId || context.companyId) {
      locationBody.companyId = input.companyId || context.companyId;
    }

    const response = await fetch(`${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(locationBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to update location: ${response.status} ${errorBody}`);
    }
  }

  if (input.businessName !== context.businessName) {
    if (nextBusinessId) {
      const response = await fetch(`${GHL_BASE_URL}/businesses/${encodeURIComponent(nextBusinessId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
        body: JSON.stringify({ name: input.businessName }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to update business: ${response.status} ${errorBody}`);
      }
    } else {
      const response = await fetch(`${GHL_BASE_URL}/businesses/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
        },
        body: JSON.stringify({ name: input.businessName, locationId }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to create business: ${response.status} ${errorBody}`);
      }
    }
  }

  const customValuesResponse = await fetchJson<{ customValues?: Record<string, unknown>[] }>(
    `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`,
    accessToken,
    { method: "GET" }
  );

  const customValues = customValuesResponse.customValues ?? [];
  const customValueByKey = getCustomValueMap(customValues);
  const upsertCustomValue = async (name: string, value: string) => {
    let existingId: string | undefined;
    for (const [apiKey, entry] of customValueByKey.entries()) {
      if (matchesCustomKey(apiKey, name)) {
        existingId = entry.id;
        break;
      }
    }

    const url = existingId
      ? `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(existingId)}`
      : `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`;

    const response = await fetch(url, {
      method: existingId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(existingId ? { name, value } : { name, value }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to save custom value ${name}: ${response.status} ${errorBody}`);
    }
  };

  await Promise.all([
    upsertCustomValue(MESSAGING_CUSTOM_KEYS.customMessage, input.customMessage || ""),
    upsertCustomValue(MESSAGING_CUSTOM_KEYS.personalizedImageEnabled, input.personalizedImageEnabled ? "true" : "false"),
    upsertCustomValue(MESSAGING_CUSTOM_KEYS.personalizedImageBaseUrl, input.personalizedImageBaseUrl || ""),
  ]);
}

export async function sendTestMessage(
  locationId: string,
  input: { contactId: string; message: string; attachmentUrl?: string }
): Promise<void> {
  const accessToken = await getValidAccessToken(locationId);
  const body: Record<string, unknown> = {
    type: "SMS",
    contactId: input.contactId,
    message: input.message,
  };

  if (input.attachmentUrl) {
    body.attachments = [input.attachmentUrl];
  }

  const response = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-04-15",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to send message: ${response.status} ${errorBody}`);
  }
}

// ─── Custom Field Discovery ──────────────────────────────────────────

// In-memory cache for custom field lookups (fieldKey -> fieldId) per location
// Keyed by locationId
const customFieldCache = new Map<string, Map<string, string>>();

/**
 * Normalize a field name for comparison.
 * Converts to lowercase and replaces spaces/hyphens with underscores.
 */
function normalizeFieldName(name: string): string {
  // Convert camelCase to snake_case, replace spaces/hyphens/other non-alphanumerics with
  // underscores, collapse multiple underscores, trim leading/trailing underscores,
  // and lowercase the result. This makes matching robust against keys like
  // "initialRequestDelay", "initial-request-delay", or "Initial Request Delay".
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/**
 * Fetch all custom fields for a location from GHL API.
 * Used internally by getCustomFieldIdByName.
 */
async function fetchLocationCustomFields(
  locationId: string,
  accessToken: string
): Promise<Array<{ id: string; fieldKey: string; displayName?: string }>> {
  // GHL API endpoint to list custom fields for a location
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

  const data = (await response.json()) as Record<string, unknown>;
  const fieldsArray = Array.isArray(data.customFields) ? data.customFields : data.fields ?? [];

  return fieldsArray
    .filter((field): field is Record<string, unknown> => !!field && typeof field === "object")
    .map((field: Record<string, unknown>) => ({
      id: typeof field.id === "string" ? field.id : "",
      fieldKey: typeof field.fieldKey === "string" ? field.fieldKey : typeof field.name === "string" ? field.name : "",
      displayName: typeof field.displayName === "string" ? field.displayName : typeof field.name === "string" ? field.name : "",
    }))
    .filter((field) => field.id && field.fieldKey);
}

/**
 * Get a custom field ID by searching for a field with a matching name.
 * Uses in-memory cache per location to minimize API calls.
 *
 * @param locationId - The GHL location ID
 * @param fieldNamePattern - The field name or key to search for (e.g., "initial_request_delay")
 * @returns The field ID if found, or null if not found
 */
export async function getCustomFieldIdByName(
  locationId: string,
  fieldNamePattern: string
): Promise<string | null> {
  const normalizedPattern = normalizeFieldName(fieldNamePattern);

  // Check cache first
  if (customFieldCache.has(locationId)) {
    const cachedFields = customFieldCache.get(locationId);
    if (cachedFields && cachedFields.has(normalizedPattern)) {
      return cachedFields.get(normalizedPattern) ?? null;
    }
  }

  try {
    const accessToken = await getValidAccessToken(locationId);
    const fields = await fetchLocationCustomFields(locationId, accessToken);

    // Build and cache the field map for this location
    const fieldMap = new Map<string, string>();
    for (const field of fields) {
      const normalized = normalizeFieldName(field.fieldKey);
      fieldMap.set(normalized, field.id);
    }

    customFieldCache.set(locationId, fieldMap);

    // Return the requested field; if not found, log available fields to help debugging
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

/**
 * Clear the custom field cache for a location.
 * Useful when custom fields are modified in GHL.
 */
export function clearCustomFieldCache(locationId?: string): void {
  if (locationId) {
    customFieldCache.delete(locationId);
  } else {
    customFieldCache.clear();
  }
}

/**
 * Upsert a custom value at the location level.
 * If a custom value with the given name exists, update it; otherwise create it.
 * 
 * @param locationId - The GHL location ID
 * @param name - The custom value name (e.g., "initial_request_scheduling")
 * @param value - The custom value (e.g., "48 hours")
 * @returns The created/updated custom value object with id, name, and value
 * @throws Error if the API call fails or token is invalid
 */
export async function upsertGhlCustomValue(
  locationId: string,
  name: string,
  value: string
): Promise<{ id: string; name: string; value: string }> {
  const accessToken = await getValidAccessToken(locationId);

  // First, fetch existing custom values to find if this one exists
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

  // Find existing custom value by matching name/key defensively using the same normalizer
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

  // Determine URL and HTTP method
  const url = existingId
    ? `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(existingId)}`
    : `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues`;

  const method = existingId ? "PUT" : "POST";

  // Upsert the custom value
  // GHL API expects just name and value for custom values
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

  const upsertData = (await upsertResponse.json()) as Record<string, unknown>;
  const customValue = upsertData.customValue ?? upsertData;

  if (!customValue) {
    const available = customValues.map((v) => (typeof v.name === "string" ? v.name : typeof v.key === "string" ? v.key : "<unknown>")).slice(0,50).join(", ");
    console.warn(`[GHL] upsertGhlCustomValue could not parse response for "${name}". Available values: ${available}`);
  }

  return {
    id: typeof customValue.id === "string" ? customValue.id : existingId ?? "",
    name: typeof customValue.name === "string" ? customValue.name : name,
    value: typeof customValue.value === "string" ? customValue.value : value,
  };
}

// ─── Token Exchange ──────────────────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called when a sub-account installs the app and GHL redirects back with a code.
 */
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

/**
 * Refresh an access token using the refresh token.
 */
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
 */
export async function upsertInstallation(
  tokenResponse: GHLTokenResponse,
  locationId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

  await db
    .insert(ghlInstallations)
    .values({
      locationId,
      companyId: tokenResponse.companyId ?? null,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      scopes: tokenResponse.scope ?? null,
      userId: tokenResponse.userId ?? null,
    })
    .onConflictDoUpdate({
      target: ghlInstallations.locationId,
      set: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        scopes: tokenResponse.scope ?? null,
        companyId: tokenResponse.companyId ?? null,
        userId: tokenResponse.userId ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get an installation by locationId.
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
    .where(
      or(
        eq(ghlInstallations.locationId, normalizedLocationId),
        eq(ghlInstallations.companyId, normalizedLocationId)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get all installations (for admin view).
 */
export async function getAllInstallations(): Promise<GHLInstallation[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(ghlInstallations);
}

/**
 * Update the workflow ID for a specific installation.
 */
/**
 * Get a valid access token for a location, refreshing if needed.
 */
export async function getValidAccessToken(
  locationId: string
): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  // Check if token needs refresh
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

/**
 * Force a refresh of the token for a location and persist the rotated refresh token.
 */
export async function refreshInstallationAccessToken(locationId: string): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  const newTokens = await refreshAccessToken(installation.refreshToken);
  await upsertInstallation(newTokens, locationId);
  return newTokens.access_token;
}

// ─── GHL API Calls ───────────────────────────────────────────────────

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  ) as T;
}

export interface GHLUpsertContactResponse {
  new?: boolean;
  contact?: {
    id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function upsertContactWithTag(
  locationId: string,
  contact: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    source?: string;
  },
  options: { retryOnUnauthorized?: boolean } = {}
): Promise<GHLUpsertContactResponse> {
  const baseBody = cleanObject({
    locationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    tags: contact.tags ?? ["trigger-royal-review"],
    source: contact.source ?? "zapier",
  });

  const postContact = async (accessToken: string) => {
    const response = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(baseBody),
    });

    const body = await response.json().catch(() => ({}));
    return { response, body };
  };

  let accessToken = await getValidAccessToken(locationId);
  let { response, body } = await postContact(accessToken);

  if (!response.ok && response.status === 401 && options.retryOnUnauthorized !== false) {
    accessToken = await refreshInstallationAccessToken(locationId);
    const retry = await postContact(accessToken);
    response = retry.response;
    body = retry.body;
  }

  if (!response.ok) {
    const errorMessage =
      typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).message === "string"
        ? String((body as Record<string, unknown>).message)
        : `Failed to upsert contact: ${response.status}`;

    throw new Error(errorMessage);
  }

  return body as GHLUpsertContactResponse;
}

/**
 * Create a single contact in GHL.
 */
export async function createContact(
  locationId: string,
  contact: GHLContactData
): Promise<GHLCreateContactResponse> {
  const accessToken = await getValidAccessToken(locationId);

  const response = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      firstName: contact.firstName,
      lastName: contact.lastName,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      locationId,
      dnd: contact.dnd || false,
      source: "Royal Review - Add Contacts",
    }),
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

/**
 * Add a contact to the review reactivation workflow.
 */
export async function addContactToWorkflow(
  locationId: string,
  contactId: string,
  workflowId: string
): Promise<{ success: boolean }> {
  const accessToken = await getValidAccessToken(locationId);
  const eventStartTime = new Date().toISOString();
  const attempts = [
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}/workflow/${workflowId}`,
      body: { eventStartTime },
    },
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}/workflow`,
      body: { workflowId, eventStartTime },
    },
    {
      url: `${GHL_BASE_URL}/contacts/${contactId}/workflows/${workflowId}`,
      body: { eventStartTime },
    },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(attempt.body),
    });

    if (response.ok) {
      return { success: true };
    }

    const errorBody = await response.json().catch(() => ({}));
    lastError =
      (errorBody as Record<string, string>).message ||
      `Failed to add to workflow: ${response.status} (${attempt.url})`;

    if (response.status !== 404 && response.status !== 405) {
      break;
    }
  }

  throw new Error(lastError || `Failed to add contact ${contactId} to workflow ${workflowId}`);
}

/**
 * Add a tag to a contact. Tries several possible GHL endpoints and falls back
 * to creating the tag first then attaching it to the contact.
 */
export async function addTagToContact(
  locationId: string,
  contactId: string,
  tagName: string
): Promise<{ success: boolean }> {
  const accessToken = await getValidAccessToken(locationId);

  // Attempt a few common endpoints / shapes that GHL might accept.
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
        return { success: true };
      }

      const body = await response.text().catch(() => "");
      lastError = `${response.status} ${body} (${attempt.url})`;

      // Try next attempt for 404/405; otherwise stop
      if (response.status !== 404 && response.status !== 405) break;
    } catch (err: any) {
      lastError = String(err?.message ?? err);
    }
  }

  // If direct contact-tagging failed, try creating the tag then attaching by id
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

/**
 * Process a single contact: create + tag with the trigger tag so workflows
 * configured to run on tag assignment will fire.
 */
export async function processContact(
  locationId: string,
  contact: GHLContactData,
  workflowId?: string
): Promise<{ contactId: string; enrolledInWorkflow: boolean }> {
  const result = await createContact(locationId, contact);
  const contactId = result.contact.id;

  // Tag-based workaround: add a trigger tag to the contact so existing GHL
  // workflows that are configured to start on that tag will run.
  const triggerTag = process.env.GHL_TRIGGER_TAG ?? "royal_review_personalizer";
  let enrolledInWorkflow = false;

  if (!contact.dnd) {
    try {
      await addTagToContact(locationId, contactId, triggerTag);
      // We can't reliably know whether a workflow was triggered by tagging,
      // so we return enrolledInWorkflow=false but the tag was added.
    } catch (error) {
      console.warn(`[GHL] Failed to add tag to contact ${contactId}:`, error);
    }
  }

  return { contactId, enrolledInWorkflow };
}
