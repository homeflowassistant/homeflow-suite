/**
 * GHL tRPC Router
 *
 * Provides backend-proxied GHL API operations:
 * - Connection status check
 * - Create single contact
 * - Process batch contacts
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { locationProcedure, router } from "../_core/trpc.js";
import {
  getInstallation,
  getLocationCustomValueMap,
  processContact,
  type GHLContactData,
} from "../ghl-service.js";
import {
  describeStaffOverlap,
  staffOverlapNotice,
  TEAM_EMAIL_KEY,
  TEAM_PHONE_KEY,
} from "../services/staff-contact-service.js";

/**
 * Team notification email/phone, used to tell the user when a contact they
 * add is (or merges into) the staff contact. Never blocks adding contacts.
 */
async function loadTeamNotificationValues(
  locationId: string
): Promise<{ email: string; phone: string } | null> {
  try {
    const values = await getLocationCustomValueMap(locationId);
    const email = values.get(TEAM_EMAIL_KEY)?.value?.trim() ?? "";
    const phone = values.get(TEAM_PHONE_KEY)?.value?.trim() ?? "";
    return email || phone ? { email, phone } : null;
  } catch (error) {
    console.warn("[GHL] Could not load team notification values", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function staffNoticeFor(
  team: { email: string; phone: string } | null,
  contact: { email?: string; phone?: string },
  dnd: boolean
): string | null {
  if (!team) return null;
  return staffOverlapNotice(describeStaffOverlap(contact, team), dnd);
}

// Contact data schema
const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  dnd: z.boolean().optional().default(false),
  tagName: z.string().optional(),
  customFields: z
    .array(
      z.object({
        fieldKey: z.string().min(1),
        fieldValue: z.any().optional(),
      })
    )
    .optional(),
});

// Batch contact schema
const batchContactSchema = z.object({
  locationId: z.string().min(1),
  contacts: z.array(contactSchema).min(1).max(500),
  dnd: z.boolean().optional().default(false),
  tagName: z.string().optional(),
});

export const ghlRouter = router({
  /**
   * Check if a GHL location is connected (has valid OAuth tokens).
   */
  connectionStatus: locationProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        console.warn(
          `[GHL] No installation found for location/company id: ${normalizedLocationId}`
        );
        return {
          connected: false,
          locationId: normalizedLocationId,
          expiresAt: null,
        };
      }

      return {
        connected: true,
        locationId: normalizedLocationId,
        expiresAt: installation.expiresAt,
      };
    }),

  /**
   * Create a single contact and optionally enroll in workflow.
   */
  createContact: locationProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contact: contactSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GHL location not connected. Please install the app first.",
        });
      }
      console.log(
        "[GHL DEBUG] router createContact - raw input from frontend:",
        JSON.stringify(input.contact, null, 2)
      );
      const contactData: GHLContactData = {
        firstName: input.contact.firstName,
        lastName: input.contact.lastName ?? "",
        email: input.contact.email ?? "",
        phone: input.contact.phone ?? "",
        dnd: input.contact.dnd ?? false,
        tagName: input.contact.tagName,
        ...(input.contact.address1?.trim()
          ? { address1: input.contact.address1.trim() }
          : {}),
        ...(input.contact.city?.trim()
          ? { city: input.contact.city.trim() }
          : {}),
        ...(input.contact.state?.trim()
          ? { state: input.contact.state.trim() }
          : {}),
        ...(input.contact.postalCode?.trim()
          ? { postalCode: input.contact.postalCode.trim() }
          : {}),
        ...(input.contact.customFields?.length
          ? { customFields: input.contact.customFields }
          : {}),
      };

      const team = await loadTeamNotificationValues(normalizedLocationId);
      const result = await processContact(normalizedLocationId, contactData);

      return {
        ...result,
        staffNotice: staffNoticeFor(team, contactData, Boolean(contactData.dnd)),
      };
    }),

  /**
   * Process a batch of contacts (CSV upload).
   */
  processBatch: locationProcedure
    .input(batchContactSchema)
    .mutation(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GHL location not connected. Please install the app first.",
        });
      }

      let successful = 0;
      let failed = 0;
      let enrolled = 0;
      const errors: Array<{ index: number; name: string; error: string }> = [];
      const staffNotices: Array<{ index: number; name: string; notice: string }> =
        [];
      const team = await loadTeamNotificationValues(normalizedLocationId);

      for (let i = 0; i < input.contacts.length; i++) {
        const contact = input.contacts[i];
        if (i === 0)
          console.log(
            "[GHL DEBUG] router processBatch - first contact raw input:",
            JSON.stringify({ contact, tagName: input.tagName }, null, 2)
          );
        const contactData: GHLContactData = {
          firstName: contact.firstName,
          lastName: contact.lastName ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          dnd: input.dnd,
          tagName: input.tagName,
          ...(contact.address1?.trim()
            ? { address1: contact.address1.trim() }
            : {}),
          ...(contact.city?.trim() ? { city: contact.city.trim() } : {}),
          ...(contact.state?.trim() ? { state: contact.state.trim() } : {}),
          ...(contact.postalCode?.trim()
            ? { postalCode: contact.postalCode.trim() }
            : {}),
          ...(contact.customFields?.length
            ? { customFields: contact.customFields }
            : {}),
        };

        try {
          const result = await processContact(
            normalizedLocationId,
            contactData
          );
          successful++;
          if (result.enrolledInWorkflow) enrolled++;
          const notice = staffNoticeFor(team, contactData, input.dnd);
          if (notice) {
            staffNotices.push({
              index: i,
              name: `${contact.firstName} ${contact.lastName}`.trim(),
              notice,
            });
          }
        } catch (error) {
          failed++;
          errors.push({
            index: i,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        // Rate limiting: wait 500ms between requests
        if (i < input.contacts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      return {
        successful,
        failed,
        enrolled,
        errors,
        staffNotices,
        total: input.contacts.length,
      };
    }),
});
