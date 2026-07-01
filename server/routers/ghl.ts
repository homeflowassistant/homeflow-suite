/**
 * GHL tRPC Router
 *
 * Provides backend-proxied GHL API operations:
 * - Connection status check
 * - Create single contact
 * - Process batch contacts
 * - Update workflow ID
 * - List installations (admin)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getInstallation,
  getAllInstallations,
  searchContacts,
  getMessagingContext,
  updateMessagingSettings,
  sendTestMessage,
  processContact,
  getValidAccessToken,
  getPipelines,
  hasOpportunityInStatus,
  getContactById,
  updateContactById,
  deleteContactById,
  syncContactReviewStatus,
  type GHLContactData,
  type GHLContactStatusFilter,
} from "../ghl-service";

// Contact data schema
const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  dnd: z.boolean().optional().default(false),
  tagName: z.string().optional(),
});

// Batch contact schema
const batchContactSchema = z.object({
  locationId: z.string().min(1),
  contacts: z.array(contactSchema).min(1).max(500),
  dnd: z.boolean().optional().default(false),
  tagName: z.string().optional(),
});

const contactsQuerySchema = z.object({
  locationId: z.string().min(1),
  query: z.string().optional().default(""),
  pageLimit: z.number().int().min(1).max(100).optional().default(25),
  searchAfter: z.array(z.string()).optional(),
  statusFilters: z.array(z.enum(["stopped", "clicked", "dnc"])).optional().default([]),
});

const messagingSettingsSchema = z.object({
  locationId: z.string().min(1),
  ownerFirstName: z.string().optional().default(""),
  ownerLastName: z.string().optional().default(""),
  businessName: z.string().optional().default(""),
  businessId: z.string().optional().default(""),
  companyId: z.string().optional().default(""),
  customMessage: z.string().optional().default(""),
  personalizedImageEnabled: z.boolean().optional().default(true),
  personalizedImageBaseUrl: z.string().optional().default(""),
});

const sendTestMessageSchema = z.object({
  locationId: z.string().min(1),
  contactId: z.string().min(1),
  message: z.string().min(1),
  attachmentUrl: z.string().optional(),
});

const updateContactSchema = z.object({
  locationId: z.string().min(1),
  contactId: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  website: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z
    .array(
      z.object({
        key: z.string(),
        field_value: z.any().optional(),
      })
    )
    .optional(),
  dnd: z.boolean().optional(),
});

const deleteContactSchema = z.object({
  locationId: z.string().min(1),
  contactId: z.string().min(1),
});

export const ghlRouter = router({
  /**
   * Check if a GHL location is connected (has valid OAuth tokens).
   */
  connectionStatus: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        console.warn(`[GHL] No installation found for location/company id: ${normalizedLocationId}`);
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
  createContact: publicProcedure
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

      const contactData: GHLContactData = {
        firstName: input.contact.firstName,
        lastName: input.contact.lastName ?? "",
        email: input.contact.email ?? "",
        phone: input.contact.phone ?? "",
        dnd: input.contact.dnd ?? false,
        tagName: input.contact.tagName,
      };

      const result = await processContact(
        normalizedLocationId,
        contactData
      );

      return result;
    }),

  /**
   * Process a batch of contacts (CSV upload).
   */
  processBatch: publicProcedure
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

      for (let i = 0; i < input.contacts.length; i++) {
        const contact = input.contacts[i];
        const contactData: GHLContactData = {
          firstName: contact.firstName,
          lastName: contact.lastName ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          dnd: input.dnd,
          tagName: input.tagName,
        };

        try {
          const result = await processContact(
            normalizedLocationId,
            contactData
          );
          successful++;
          if (result.enrolledInWorkflow) enrolled++;
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
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      return { successful, failed, enrolled, errors, total: input.contacts.length };
    }),

  /**
   * Get all installations (admin view).
   */
  listInstallations: protectedProcedure.query(async () => {
    const installations = await getAllInstallations();
    return installations.map((inst) => ({
      locationId: inst.locationId,
      companyId: inst.companyId,
      connected: Date.now() < inst.expiresAt,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    }));
  }),

  /**
   * Fetch and normalize contacts from GHL for the read-only Contacts page.
   */
  listContacts: publicProcedure
    .input(contactsQuerySchema)
    .query(async ({ input }) => {
      const result = await searchContacts(input.locationId.trim(), {
        query: input.query,
        pageLimit: input.pageLimit,
        searchAfter: input.searchAfter,
        statusFilters: input.statusFilters as GHLContactStatusFilter[],
      });

      return result;
    }),

  /**
   * Load the messaging page context from the installed GHL app token.
   */
  messagingContext: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      return getMessagingContext(input.locationId.trim());
    }),

  /**
   * Persist messaging page settings through the installed GHL app token.
   */
  updateMessagingSettings: publicProcedure
    .input(messagingSettingsSchema)
    .mutation(async ({ input }) => {
      await updateMessagingSettings(input.locationId.trim(), {
        ownerFirstName: input.ownerFirstName.trim(),
        ownerLastName: input.ownerLastName.trim(),
        businessName: input.businessName.trim(),
        businessId: input.businessId.trim() || undefined,
        companyId: input.companyId.trim() || undefined,
        customMessage: input.customMessage,
        personalizedImageEnabled: input.personalizedImageEnabled,
        personalizedImageBaseUrl: input.personalizedImageBaseUrl,
      });

      return { success: true };
    }),

  /**
   * Send the messaging page test SMS through the installed GHL app token.
   */
  sendTestMessage: publicProcedure
    .input(sendTestMessageSchema)
    .mutation(async ({ input }) => {
      await sendTestMessage(input.locationId.trim(), {
        contactId: input.contactId.trim(),
        message: input.message,
        attachmentUrl: input.attachmentUrl?.trim() || undefined,
      });

      return { success: true };
    }),

  /**
   * Verify that the access token is valid by attempting to use it.
   */
  verifyConnection: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const token = await getValidAccessToken(input.locationId.trim());
        return { valid: true, message: "Connection is active" };
      } catch (error) {
        return {
          valid: false,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }),

  /**
   * Fetch pipelines for a location.
   * Used to find the Review pipeline ID dynamically.
   */
  getPipelines: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const pipelines = await getPipelines(input.locationId.trim());
      return pipelines;
    }),

  /**
   * Fetch a single contact's current details.
   */
  getContact: publicProcedure
    .input(z.object({ locationId: z.string().min(1), contactId: z.string().min(1) }))
    .query(async ({ input }) => {
      return getContactById(input.locationId.trim(), input.contactId.trim());
    }),

  /**
   * Refresh and optionally sync a contact's review status.
   */
  refreshContactStatus: publicProcedure
    .input(z.object({ locationId: z.string().min(1), contactId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return syncContactReviewStatus(input.locationId.trim(), input.contactId.trim());
    }),

  /**
   * Update a contact directly in GHL.
   */
  updateContact: publicProcedure
    .input(updateContactSchema)
    .mutation(async ({ input }) => {
      console.log("[tRPC] updateContact called with:", {
        locationId: input.locationId,
        contactId: input.contactId,
      });

      try {
        const updated = await updateContactById(input.locationId.trim(), input.contactId.trim(), {
          firstName: input.firstName?.trim(),
          lastName: input.lastName?.trim(),
          name: input.name?.trim(),
          email: input.email?.trim(),
          phone: input.phone?.trim(),
          address1: input.address1?.trim(),
          city: input.city?.trim(),
          state: input.state?.trim(),
          postalCode: input.postalCode?.trim(),
          website: input.website?.trim(),
          source: input.source?.trim(),
          tags: input.tags,
          customFields: input.customFields,
          dnd: input.dnd,
        });

        console.log("[tRPC] updateContact succeeded");
        return { contact: updated };
      } catch (error) {
        console.error("[tRPC] updateContact failed:", error);
        throw error;
      }
    }),

  /**
   * Delete a contact directly in GHL.
   */
  deleteContact: publicProcedure
    .input(deleteContactSchema)
    .mutation(async ({ input }) => {
      console.log("[tRPC] deleteContact called with:", {
        locationId: input.locationId,
        contactId: input.contactId,
      });

      try {
        await deleteContactById(input.locationId.trim(), input.contactId.trim());
        console.log("[tRPC] deleteContact succeeded");
        return { success: true };
      } catch (error) {
        console.error("[tRPC] deleteContact failed:", error);
        throw error;
      }
    }),

  /**
   * Check if a contact has a won opportunity in a specific pipeline.
   * Used to determine "Clicked" status.
   */
  hasWonOpportunity: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        pipelineId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const hasWon = await hasOpportunityInStatus(
        input.locationId.trim(),
        input.contactId.trim(),
        input.pipelineId.trim(),
        "won"
      );
      return { hasWon };
    }),
});
