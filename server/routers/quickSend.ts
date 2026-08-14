/**
 * Quick Send tRPC Router
 *
 * Provides:
 * - getContacts: Search/list contacts for the contact selection modal
 * - saveMessage: Save message to GHL custom value + tag selected contacts
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getValidAccessToken,
  findCustomValueId,
  fetchAllCustomValues,
  addTagToContact,
} from "../ghl-service";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const QUICK_SEND_TAG = "quick-send";

// ─── GHL Headers Helper ──────────────────────────────────────────────
function ghlHeaders(accessToken: string, contentType = "application/json") {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    "Content-Type": contentType,
    Accept: "application/json",
  };
}

// ─── Quick Send Router ───────────────────────────────────────────────
export const quickSendRouter = router({
  /**
   * Search and list contacts for the contact selection modal.
   * Uses GHL contacts/search endpoint with pagination.
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

      // If search query, use the search endpoint
      if (input.search.trim()) {
        return searchContacts(
          locationId,
          accessToken,
          input.search.trim(),
          input.page,
          input.pageSize
        );
      }

      // Otherwise, list contacts with pagination
      return listContacts(locationId, accessToken, input.page, input.pageSize);
    }),

  /**
   * Save the Quick Send message to GHL custom value and tag selected contacts.
   * 1. Updates the "Mass SMS Message" custom value (existing only, never creates new)
   * 2. Tags all selected contacts with "quick-send"
   */
  saveMessage: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1, "Location ID is required"),
        message: z.string().min(1, "Message is required"),
        contactSelection: z.enum(["all", "selected"]),
        contactIds: z.array(z.string().min(1)).optional().default([]),
      })
    )
    .mutation(async ({ input }) => {
      const locationId = input.locationId.trim();

      // Validate
      if (!locationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Location ID cannot be empty",
        });
      }
      if (!input.message.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message cannot be empty",
        });
      }

      const accessToken = await getValidAccessToken(locationId);

      // ── Step 1: Save message to GHL custom value ──
      const messageSaved = await saveMessageToCustomValue(
        locationId,
        accessToken,
        input.message.trim()
      );

      // ── Step 2: Tag selected contacts ──
      let tagResults = { total: 0, tagged: 0, failed: 0 };

      if (input.contactSelection === "all") {
        // Get all contact IDs and tag them
        tagResults = await tagAllContacts(locationId, accessToken);
      } else if (
        input.contactSelection === "selected" &&
        input.contactIds.length > 0
      ) {
        tagResults = await tagContactsByIds(
          locationId,
          accessToken,
          input.contactIds
        );
      }

      return {
        success: true,
        messageSaved,
        contactsTagged: tagResults,
      };
    }),
});

// ─── Helper: List contacts with pagination ───────────────────────────
async function listContacts(
  locationId: string,
  accessToken: string,
  page: number,
  pageSize: number
): Promise<{ contacts: any[]; total: number; page: number; pageSize: number }> {
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
  const contacts = (data.contacts || []).map((c: any) => ({
    id: c.id,
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    name: c.name || "",
    email: c.email || "",
    phone: c.phone || "",
  }));

  return {
    contacts,
    total: data.totalCount || contacts.length,
    page,
    pageSize,
  };
}

// ─── Helper: Search contacts ─────────────────────────────────────────
async function searchContacts(
  locationId: string,
  accessToken: string,
  query: string,
  page: number,
  pageSize: number
): Promise<{ contacts: any[]; total: number; page: number; pageSize: number }> {
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
  const contacts = (data.contacts || []).map((c: any) => ({
    id: c.id,
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    name: c.name || "",
    email: c.email || "",
    phone: c.phone || "",
  }));

  return {
    contacts,
    total: data.totalCount || contacts.length,
    page,
    pageSize,
  };
}

// ─── Helper: Save message to GHL custom value ────────────────────────
async function saveMessageToCustomValue(
  locationId: string,
  accessToken: string,
  message: string
): Promise<boolean> {
  // Fetch all custom values
  let customValues: any[];
  try {
    customValues = await fetchAllCustomValues(locationId, accessToken);
  } catch (err) {
    console.error("[QuickSend] Failed to fetch custom values:", err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Failed to fetch GHL custom values. Please check your connection.",
    });
  }

  // Find the "Mass SMS Message" custom value
  const customValueId = findCustomValueId(customValues, "Mass SMS Message");

  if (!customValueId) {
    // Also try alternate matching
    const alternate = customValues.find(cv => {
      const name = String(cv.name || cv.key || cv.fieldKey || "").toLowerCase();
      return (
        name.includes("mass") &&
        name.includes("sms") &&
        name.includes("message")
      );
    });
    const altId = (alternate?.id || alternate?._id) as string | undefined;
    if (altId) {
      return doPutCustomValue(
        locationId,
        accessToken,
        altId,
        String(alternate?.name || "Mass SMS Message"),
        message
      );
    }
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        'Custom value "Mass SMS Message" not found in your GHL account. Please ensure it exists before saving.',
    });
  }

  // Get the display name to preserve it
  const existingCv = customValues.find(
    cv => (cv.id || cv._id) === customValueId
  );
  const displayName = String(existingCv?.name || "Mass SMS Message");

  return doPutCustomValue(
    locationId,
    accessToken,
    customValueId,
    displayName,
    message
  );
}

async function doPutCustomValue(
  locationId: string,
  accessToken: string,
  customValueId: string,
  displayName: string,
  value: string
): Promise<boolean> {
  const url = `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(customValueId)}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: ghlHeaders(accessToken),
    body: JSON.stringify({ name: displayName, value }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(
      `[QuickSend] Failed to update custom value: ${resp.status} ${body}`
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to save message to GHL. Error: ${resp.status}`,
    });
  }

  return true;
}

// ─── Helper: Tag all contacts ────────────────────────────────────────
async function tagAllContacts(
  locationId: string,
  accessToken: string
): Promise<{ total: number; tagged: number; failed: number }> {
  let allContactIds: string[] = [];
  let page = 1;
  const pageSize = 100;

  // Paginate through all contacts
  while (true) {
    const url = `${GHL_BASE_URL}/contacts/?locationId=${encodeURIComponent(locationId)}&page=${page}&limit=${pageSize}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: ghlHeaders(accessToken),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(
        `[QuickSend] Failed to fetch contacts page ${page}: ${resp.status} ${body}`
      );
      break;
    }

    const data = (await resp.json()) as any;
    const contacts = data.contacts || [];
    allContactIds = allContactIds.concat(contacts.map((c: any) => c.id));

    if (contacts.length < pageSize) break;
    page++;
  }

  return tagContactsByIds(locationId, accessToken, allContactIds);
}

// ─── Helper: Tag contacts by IDs ─────────────────────────────────────
async function tagContactsByIds(
  locationId: string,
  accessToken: string,
  contactIds: string[]
): Promise<{ total: number; tagged: number; failed: number }> {
  let tagged = 0;
  let failed = 0;

  for (let i = 0; i < contactIds.length; i++) {
    try {
      await addTagToContact(locationId, contactIds[i], QUICK_SEND_TAG);
      tagged++;
    } catch (err) {
      console.warn(`[QuickSend] Failed to tag contact ${contactIds[i]}:`, err);
      failed++;
    }

    // Rate limiting: wait 200ms between tag requests
    if (i < contactIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return {
    total: contactIds.length,
    tagged,
    failed,
  };
}
