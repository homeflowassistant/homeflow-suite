/**
 * Contacts tRPC Router
 *
 * Provides:
 * - getContacts: Fetch contacts with full details (tags, DND, dateAdded) from GHL
 * - refreshContact: Fetch a single contact enriched with status columns
 * - updateContact: Update contact fields (name, email, phone) via GHL PUT
 * - toggleDnd: Enable or disable Do Not Disturb for a contact
 * - addTag: Add a tag to a contact
 * - removeTag: Remove a tag from a contact
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getValidAccessToken } from "../ghl-service";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

// ─── Tag names used by the application ─────────────────────────────────
export const CAMPAIGN_TAGS = {
  LEAD_FOLLOWUP_ACTIVE: "new lead (via homeflow)",
  LEAD_FOLLOWUP_COMPLETE: "new lead finished",
  REACTIVATION_ACTIVE: "homeflow: inactive customer",
  REACTIVATION_COMPLETE: "homeflow: inactive customer finished",
  ADDON_ACTIVE: "add-on-campaign",
  ADDON_COMPLETE: "add-on-campaign finished",
} as const;

function ghlHeaders(
  accessToken: string,
  contentType = "application/json",
  apiVersion: string = GHL_API_VERSION
) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: apiVersion,
    Accept: "application/json",
    "Content-Type": contentType,
  };
}

// ─── Contact Type ─────────────────────────────────────────────────────
export interface GHLContact {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  dnd: boolean;
  dateAdded: string | null;
  dateUpdated: string | null;
  tags: string[];
  customFields: Array<{
    id: string;
    key: string;
    value: any;
    name: string;
  }>;
}

// ─── Status Type ──────────────────────────────────────────────────────
export type WorkflowStatus = "Active" | "Completed" | "DND" | null;

export interface ContactWithStatus extends GHLContact {
  leadFollowUpStatus: WorkflowStatus;
  reactivationStatus: WorkflowStatus;
  addOnStatus: WorkflowStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hasTag(tags: string[], targetTag: string): boolean {
  return tags.some(
    tag => tag.toLowerCase().trim() === targetTag.toLowerCase().trim()
  );
}

/**
 * Determine workflow status for a given campaign type.
 * Priority: DND > Completed (finished tag) > Active (active tag) > null
 *
 * If a contact has both a completed tag and an active tag, Completed wins.
 * If a contact is DND, DND always wins regardless of tags.
 */
function determineStatus(
  tags: string[],
  isDnd: boolean,
  activeTag: string,
  completeTag: string
): WorkflowStatus {
  if (isDnd) return "DND";
  if (hasTag(tags, completeTag)) return "Completed";
  if (hasTag(tags, activeTag)) return "Active";
  return null;
}

/**
 * Enrich a normalized contact with status columns.
 */
function enrichWithStatus(contact: GHLContact): ContactWithStatus {
  return {
    ...contact,
    leadFollowUpStatus: determineStatus(
      contact.tags,
      contact.dnd,
      CAMPAIGN_TAGS.LEAD_FOLLOWUP_ACTIVE,
      CAMPAIGN_TAGS.LEAD_FOLLOWUP_COMPLETE
    ),
    reactivationStatus: determineStatus(
      contact.tags,
      contact.dnd,
      CAMPAIGN_TAGS.REACTIVATION_ACTIVE,
      CAMPAIGN_TAGS.REACTIVATION_COMPLETE
    ),
    addOnStatus: determineStatus(
      contact.tags,
      contact.dnd,
      CAMPAIGN_TAGS.ADDON_ACTIVE,
      CAMPAIGN_TAGS.ADDON_COMPLETE
    ),
  };
}

// ─── GHL API Helpers ──────────────────────────────────────────────────

async function fetchContactById(
  locationId: string,
  accessToken: string,
  contactId: string
): Promise<ContactWithStatus> {
  const resp = await fetch(
    `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
    {
      method: "GET",
      headers: ghlHeaders(accessToken),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch contact: ${resp.status} ${body}`,
    });
  }

  const data = (await resp.json()) as any;
  const rawContact = data.contact || data;
  return enrichWithStatus(normalizeContact(rawContact));
}

async function fetchContacts(
  locationId: string,
  accessToken: string,
  page: number,
  pageSize: number,
  search?: string
): Promise<{
  contacts: GHLContact[];
  total: number;
  page: number;
  pageSize: number;
}> {
  if (search && search.trim()) {
    return searchContacts(
      locationId,
      accessToken,
      search.trim(),
      page,
      pageSize
    );
  }
  return listContacts(locationId, accessToken, page, pageSize);
}

async function listContacts(
  locationId: string,
  accessToken: string,
  page: number,
  pageSize: number
): Promise<{
  contacts: GHLContact[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const url = `${GHL_BASE_URL}/contacts/?locationId=${encodeURIComponent(locationId)}&page=${page}&limit=${pageSize}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: ghlHeaders(accessToken),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch contacts: ${resp.status} ${body}`,
    });
  }

  const data = (await resp.json()) as any;
  const contacts = (data.contacts || []).map(normalizeContact);

  return {
    contacts,
    total: data.totalCount || contacts.length,
    page,
    pageSize,
  };
}

async function searchContacts(
  locationId: string,
  accessToken: string,
  query: string,
  page: number,
  pageSize: number
): Promise<{
  contacts: GHLContact[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // GHL's advanced search endpoint requires at least 3 characters for any
  // `contains` filter — shorter queries return:
  //   400 {"message":"Min. 3 characters required for applying contains filter"}
  // To keep 1–2 character searches working (e.g. typing "m" shows contacts
  // starting with m), short queries skip the advanced search endpoint and go
  // straight to the local list-based filter, which has no minimum length.
  if (query.length < 3) {
    return filterLocalSearch(locationId, accessToken, query, page, pageSize);
  }

  // GHL advanced search endpoint: POST /contacts/search (Version header v3).
  // Per the official docs:
  // - `pageLimit` (required) controls results per page; `limit` is not a valid
  //   parameter and would be silently dropped / cause unexpected behaviour
  // - `email` and `name` do not support the `contains` operator; name lookups
  //   must use `firstNameLowerCase` / `lastNameLowerCase` for `contains`
  // - Unsupported fields/operators in the payload make GHL return 400, which
  //   is what broke searching on the contacts page
  const url = `${GHL_BASE_URL}/contacts/search`;

  const resp = await fetch(url, {
    method: "POST",
    headers: ghlHeaders(accessToken, undefined, "v3"),
    body: JSON.stringify({
      locationId,
      query,
      filters: [
        {
          group: "OR",
          filters: [
            { field: "email", operator: "eq", value: query },
            { field: "firstNameLowerCase", operator: "contains", value: query.toLowerCase() },
            { field: "lastNameLowerCase", operator: "contains", value: query.toLowerCase() },
            { field: "phone", operator: "eq", value: query },
          ],
        },
      ],
      sort: [{ field: "dateAdded", direction: "desc" }],
      page,
      pageLimit: pageSize,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.warn(
      `[Contacts] GHL advanced search failed (${resp.status}): ${body.slice(0, 200)} — falling back to list endpoint with local filtering`
    );
    // The advanced search endpoint is flaky across locations (unsupported
    // fields/operators differ per sub-account configuration). Rather than
    // failing with a 500, fall back to the stable list endpoint and apply
    // the same filters locally so searching never breaks.
    return filterLocalSearch(locationId, accessToken, query, page, pageSize);
  }

  const data = (await resp.json()) as any;
  const contacts = (data.contacts || data.data?.contacts || []).map(
    normalizeContact
  );
  const total = data.totalCount || data.data?.totalCount || contacts.length;

  return {
    contacts,
    total,
    page,
    pageSize,
  };
}

/**
 * Local search fallback: fetch the first page from the stable list endpoint
 * and filter by email / name / phone client-side (server-side, really).
 * The list endpoint (GET /contacts/) is the most reliable GHL endpoint,
 * used by the app without search with no known failures.
 */
async function filterLocalSearch(
  locationId: string,
  accessToken: string,
  query: string,
  page: number,
  pageSize: number
): Promise<{
  contacts: GHLContact[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const needle = query.toLowerCase();

  // If the query looks like a phone number, also search the digit-only form
  // so partial phone matches work (e.g. "555123").
  const digits = query.replace(/\D/g, "");

  function matches(c: GHLContact): boolean {
    if (c.email.toLowerCase().includes(needle)) return true;
    if (c.name.toLowerCase().includes(needle)) return true;
    if (c.firstName.toLowerCase().includes(needle)) return true;
    if (c.lastName.toLowerCase().includes(needle)) return true;
    if (digits && c.phone.replace(/\D/g, "").includes(digits)) return true;
    return false;
  }

  // Pull enough contacts to fill the requested page of matches.
  const fetched: GHLContact[] = [];
  const pagesToFetch = Math.min(page, 20);
  for (let p = 1; p <= pagesToFetch; p++) {
    const result = await listContacts(locationId, accessToken, p, pageSize);
    fetched.push(...result.contacts);
    if (result.contacts.length < pageSize) break;
    // Stop early once we have enough raw contacts to satisfy the page.
    if (fetched.length >= page * pageSize) break;
  }

  const filtered = fetched.filter(matches);
  const total = filtered.length;
  const start = (page - 1) * pageSize;

  return {
    contacts: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  };
}

/**
 * Normalize a raw GHL contact response into our typed GHLContact.
 */
function normalizeContact(c: any): GHLContact {
  return {
    id: c.id || "",
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    name:
      c.name ||
      [c.firstName, c.lastName].filter(Boolean).join(" ") ||
      "Unknown",
    email: c.email || "",
    phone: c.phone || "",
    dnd: !!c.dnd,
    dateAdded: c.dateAdded || c.date_created || null,
    dateUpdated: c.dateUpdated || c.date_updated || null,
    tags: Array.isArray(c.tags)
      ? c.tags.map((t: any) =>
          typeof t === "string" ? t : t?.name || t?.tagName || ""
        )
      : [],
    customFields: Array.isArray(c.customFields)
      ? c.customFields.map((cf: any) => ({
          id: cf.id || "",
          key: cf.key || cf.fieldKey || "",
          value: cf.value || cf.fieldValue,
          name: cf.name || cf.fieldKey || "",
        }))
      : [],
  };
}

// ─── Router ───────────────────────────────────────────────────────────

export const contactsRouter = router({
  /**
   * Fetch contacts with workflow status information.
   */
  getContacts: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        search: z.string().optional().default(""),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(50),
      })
    )
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);

      const result = await fetchContacts(
        locationId,
        accessToken,
        input.page,
        input.pageSize,
        input.search
      );

      const contactsWithStatus: ContactWithStatus[] =
        result.contacts.map(enrichWithStatus);

      return {
        contacts: contactsWithStatus,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
    }),

  /**
   * Refresh a single contact's data by fetching it directly from GHL.
   */
  refreshContact: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      return fetchContactById(locationId, accessToken, input.contactId);
    }),

  /**
   * Update a contact's basic fields (name, email, phone) in GHL.
   * Uses PUT /contacts/{id} to preserve existing data.
   */
  updateContact: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().optional().default(""),
        email: z.string().optional().default(""),
        phone: z.string().optional().default(""),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      const contactId = input.contactId.trim();

      const payload = {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim() || undefined,
        name:
          `${input.firstName.trim()} ${input.lastName.trim()}`.trim() ||
          undefined,
        email: input.email.trim() || undefined,
        phone: input.phone.trim() || undefined,
      };

      const resp = await fetch(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
        {
          method: "PUT",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify(payload),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to update contact: ${resp.status} ${body}`,
        });
      }

      const data = (await resp.json()) as any;
      const updated = data.contact || data;
      return {
        success: true,
        contact: enrichWithStatus(normalizeContact(updated)),
      };
    }),

  /**
   * Toggle Do Not Disturb (DND) status for a contact.
   */
  toggleDnd: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      const contactId = input.contactId.trim();

      // First, fetch the contact to check current DND status
      const getResp = await fetch(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
        {
          method: "GET",
          headers: ghlHeaders(accessToken),
        }
      );

      if (!getResp.ok) {
        const body = await getResp.text();
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch contact: ${getResp.status} ${body}`,
        });
      }

      const getData = (await getResp.json()) as any;
      const existingContact = getData.contact || getData;
      const currentDnd = !!existingContact.dnd;
      const newDnd = !currentDnd;

      // Update the contact with the toggled DND value
      const putPayload = {
        firstName: existingContact.firstName,
        lastName: existingContact.lastName,
        name:
          existingContact.name ||
          `${existingContact.firstName || ""} ${existingContact.lastName || ""}`.trim(),
        email: existingContact.email || undefined,
        phone: existingContact.phone || undefined,
        dnd: newDnd,
      };

      const putResp = await fetch(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
        {
          method: "PUT",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify(putPayload),
        }
      );

      if (!putResp.ok) {
        const body = await putResp.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to toggle DND: ${putResp.status} ${body}`,
        });
      }

      const putData = (await putResp.json()) as any;
      const updatedContact = putData.contact || putData;
      return {
        success: true,
        dndEnabled: newDnd,
        contact: enrichWithStatus(normalizeContact(updatedContact)),
      };
    }),

  /**
   * Add a tag to a contact.
   */
  addTag: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        tagName: z.string().min(1, "Tag name is required"),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      const contactId = input.contactId.trim();

      // Attempt multiple endpoint patterns for adding tags
      const endpoints = [
        {
          url: `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}/tags`,
          method: "POST",
          body: { tags: [input.tagName] },
        },
        {
          url: `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}/tag`,
          method: "POST",
          body: { tag: input.tagName },
        },
      ];

      let lastError = "";
      for (const endpoint of endpoints) {
        try {
          const resp = await fetch(endpoint.url, {
            method: endpoint.method,
            headers: ghlHeaders(accessToken),
            body: JSON.stringify(endpoint.body),
          });

          if (resp.ok) {
            // Tag added successfully — fetch updated contact
            return {
              success: true,
              contact: await fetchContactById(
                locationId,
                accessToken,
                contactId
              ),
            };
          }

          const body = await resp.text();
          lastError = `${resp.status} ${body} (${endpoint.url})`;
          if (resp.status !== 404 && resp.status !== 405) break;
        } catch (err: any) {
          lastError = String(err?.message ?? err);
        }
      }

      // Fallback: create the tag first, then attach by ID
      try {
        const createResp = await fetch(`${GHL_BASE_URL}/tags`, {
          method: "POST",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ name: input.tagName, locationId }),
        });

        if (createResp.ok) {
          const created = (await createResp.json()) as any;
          const tagId = created.id || created.tagId;
          if (tagId) {
            const attachResp = await fetch(
              `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tagId)}`,
              {
                method: "POST",
                headers: ghlHeaders(accessToken),
              }
            );

            if (attachResp.ok) {
              return {
                success: true,
                contact: await fetchContactById(
                  locationId,
                  accessToken,
                  contactId
                ),
              };
            }
          }
        }
      } catch {
        // Fallback also failed
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to add tag "${input.tagName}" to contact: ${lastError || "All attempts failed"}`,
      });
    }),

  /**
   * Remove a tag from a contact.
   */
  removeTag: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        tagName: z.string().min(1, "Tag name is required"),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      const contactId = input.contactId.trim();

      const resp = await fetch(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}/tags`,
        {
          method: "DELETE",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: [input.tagName] }),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to remove tag "${input.tagName}": ${resp.status} ${body}`,
        });
      }

      return {
        success: true,
        contact: await fetchContactById(locationId, accessToken, contactId),
      };
    }),

  /**
   * Fetch all tags available in the GHL account/location.
   * Used to populate the tag selection dropdown in the Manage Tags dialog.
   */
  getAccountTags: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);

      // Correct GHL endpoint: GET /locations/:locationId/tags
      const url = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/tags`;
      const endpoints = [url];

      let lastError = "";
      for (const url of endpoints) {
        try {
          const resp = await fetch(url, {
            method: "GET",
            headers: ghlHeaders(accessToken),
          });

          if (resp.ok) {
            const data = (await resp.json()) as any;
            const tags: string[] = [];

            // Handle different response shapes
            if (Array.isArray(data)) {
              data.forEach((t: any) => {
                const name =
                  typeof t === "string" ? t : t?.name || t?.tagName || "";
                if (name) tags.push(name);
              });
            } else if (Array.isArray(data.tags)) {
              data.tags.forEach((t: any) => {
                const name =
                  typeof t === "string" ? t : t?.name || t?.tagName || "";
                if (name) tags.push(name);
              });
            }

            // Deduplicate and sort alphabetically
            return {
              tags: Array.from(new Set(tags)).sort((a, b) =>
                a.localeCompare(b)
              ),
            };
          }

          const body = await resp.text();
          lastError = `${resp.status} ${body} (${url})`;
        } catch (err: any) {
          lastError = String(err?.message ?? err);
        }
      }

      // If all endpoints fail, return empty array with a warning
      console.warn(`Failed to fetch account tags: ${lastError}`);
      return { tags: [] };
    }),

  /**
   * Delete a contact from GHL.
   */
  deleteContact: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getValidAccessToken(locationId);
      const contactId = input.contactId.trim();

      const resp = await fetch(
        `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
        {
          method: "DELETE",
          headers: ghlHeaders(accessToken),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to delete contact: ${resp.status} ${body}`,
        });
      }

      return { success: true };
    }),
});
