/**
 * Contacts tRPC Router
 *
 * Provides:
 * - getContacts: Fetch contacts with full details (tags, DND, dateAdded) from GHL
 * - getContactTags: Fetch tags for specific contacts to determine workflow status
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getValidAccessToken } from "../ghl-service";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

// ─── Tag names used by the application ─────────────────────────────────
// These match the tags used in CSVUploadFlow.tsx
export const CAMPAIGN_TAGS = {
  LEAD_FOLLOWUP_ACTIVE: "new lead (via homeflow)",
  LEAD_FOLLOWUP_COMPLETE: "new lead finished",
  REACTIVATION_ACTIVE: "homeflow: inactive customer",
  REACTIVATION_COMPLETE: "homeflow: inactive customer finished",
  ADDON_ACTIVE: "add-on-campaign",
  ADDON_COMPLETE: "add-on-campaign finished",
} as const;

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
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
export type WorkflowStatus = "Active" | "Complete" | "DND" | null;

export interface ContactWithStatus extends GHLContact {
  leadFollowUpStatus: WorkflowStatus;
  reactivationStatus: WorkflowStatus;
  addOnStatus: WorkflowStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function hasTag(tags: string[], targetTag: string): boolean {
  return tags.some(
    (tag) => tag.toLowerCase().trim() === targetTag.toLowerCase().trim()
  );
}

/**
 * Determine workflow status for a given campaign type.
 * Priority: DND > Active (active tag) > Complete (finished tag) > null
 */
function determineStatus(
  tags: string[],
  isDnd: boolean,
  activeTag: string,
  completeTag: string
): WorkflowStatus {
  if (isDnd) return "DND";
  if (hasTag(tags, activeTag)) return "Active";
  if (hasTag(tags, completeTag)) return "Complete";
  return null;
}

// ─── GHL API Helpers ──────────────────────────────────────────────────

async function fetchContacts(
  locationId: string,
  accessToken: string,
  page: number,
  pageSize: number,
  search?: string
): Promise<{ contacts: GHLContact[]; total: number; page: number; pageSize: number }> {
  if (search && search.trim()) {
    return searchContacts(locationId, accessToken, search.trim(), page, pageSize);
  }
  return listContacts(locationId, accessToken, page, pageSize);
}

async function listContacts(
  locationId: string,
  accessToken: string,
  page: number,
  pageSize: number
): Promise<{ contacts: GHLContact[]; total: number; page: number; pageSize: number }> {
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
): Promise<{ contacts: GHLContact[]; total: number; page: number; pageSize: number }> {
  const url = `${GHL_BASE_URL}/contacts/search`;

  const resp = await fetch(url, {
    method: "POST",
    headers: ghlHeaders(accessToken),
    body: JSON.stringify({
      locationId,
      searchText: query,
      page,
      limit: pageSize,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to search contacts: ${resp.status} ${body}`,
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

/**
 * Normalize a raw GHL contact response into our typed GHLContact.
 */
function normalizeContact(c: any): GHLContact {
  return {
    id: c.id || "",
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
    email: c.email || "",
    phone: c.phone || "",
    dnd: !!c.dnd,
    dateAdded: c.dateAdded || c.date_created || null,
    dateUpdated: c.dateUpdated || c.date_updated || null,
    tags: Array.isArray(c.tags)
      ? c.tags.map((t: any) => (typeof t === "string" ? t : t?.name || t?.tagName || ""))
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
   * Returns contacts enriched with status columns for Lead Follow-Up,
   * Reactivation, and Add-On based on their GHL tags and DND state.
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

      // Enrich each contact with status columns
      const contactsWithStatus: ContactWithStatus[] = result.contacts.map((contact) => ({
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
      }));

      return {
        contacts: contactsWithStatus,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
    }),

  /**
   * Refresh a single contact's data by fetching it directly from GHL.
   * Useful for updating status after tag changes.
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

      const resp = await fetch(`${GHL_BASE_URL}/contacts/${input.contactId}`, {
        method: "GET",
        headers: ghlHeaders(accessToken),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch contact: ${resp.status} ${body}`,
        });
      }

      const data = (await resp.json()) as any;
      const rawContact = data.contact || data;
      const contact = normalizeContact(rawContact);

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
    }),
});
