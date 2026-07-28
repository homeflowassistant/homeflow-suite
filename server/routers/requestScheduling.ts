import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { getLocationAccessToken } from "../helpers/tokenHelper.js";
import { getCustomFieldIdByName, upsertGhlCustomValue } from "../ghl-service.js";

const FOLLOW_UP_CUSTOM_VALUE_NAME = "08. How Many Times Should We Follow-Up For A Review? (0, 1, 2, or 3)";

const TIMING_MAP = {
  0: "within_24h",
  1: "24h",
  2: "48h",
  3: "1week",
} as const;

const REVERSE_TIMING_MAP: Record<string, 0 | 1 | 2 | 3> = {
  within_24h: 0,
  "24h": 1,
  "48h": 2,
  "1week": 3,
};

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: "2023-02-21",
    "Content-Type": "application/json",
  };
}

/**
 * Discover custom field IDs for a location by name.
 * These field IDs are generic across subaccounts and are discovered at runtime.
 */
async function getRequestSchedulingFieldIds(locationId: string): Promise<{
  initialDelayFieldId: string;
  followUpLimitFieldId: string;
}> {
  const initialDelayFieldId = await getCustomFieldIdByName(locationId, "initial_request_delay");
  const followUpLimitFieldId = await getCustomFieldIdByName(locationId, "service_type");

  if (!initialDelayFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Custom field 'initial_request_delay' not found in your GHL account. Please create this field in Settings > Custom Fields.",
    });
  }

  if (!followUpLimitFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Custom field 'service_type' ({{custom_values.service_type}}) not found in your GHL account. Please create this field in Settings > Custom Fields.",
    });
  }


  return {
    initialDelayFieldId,
    followUpLimitFieldId,
  };
}

  const saveSettingsProcedure = publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        initialTiming: z.number().int().min(0).max(3),
        followUpCount: z.number().int().min(0).max(3),
        isPaused: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const { initialDelayFieldId, followUpLimitFieldId } = await getRequestSchedulingFieldIds(input.locationId.trim());
      const accessToken = await getLocationAccessToken(input.locationId.trim());
      const contactId = input.contactId.trim();

      await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
        method: "PUT",
        headers: ghlHeaders(accessToken),
        body: JSON.stringify({
          customFields: [
            {
              id: initialDelayFieldId,
              key: "initial_request_delay",
              field_value: TIMING_MAP[input.initialTiming as keyof typeof TIMING_MAP],
            },
            {
              id: followUpLimitFieldId,
              key: "service_type",
              field_value: input.followUpCount,
            },
          ],
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to update request scheduling settings: ${response.status} ${errorBody}`,
          });
        }
      });

      if (input.isPaused) {
        const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "POST",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to add Pause_Reviews tag: ${response.status} ${errorBody}`,
          });
        }
      } else {
        const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "DELETE",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to remove Pause_Reviews tag: ${response.status} ${errorBody}`,
          });
        }
      }

      return { success: true };
    });

// ─── Custom Quote Data Schema (same as Reactivation page) ────────────
const customQuoteDataSchema = z.object({
  businessLogo:       z.string().optional(),
  businessName:       z.string().optional(),
  businessOwnerName:  z.string().optional(),
  bioText:            z.string().optional(),
  companyImage:       z.string().optional(),
  discountOffer:      z.string().optional(),
  offerDescription:   z.string().optional(),
  offerPricePerVisit: z.string().optional(),
  offerTotal:         z.string().optional(),
  offerImage:         z.string().optional(),
  sendQuoteAutomatically: z.boolean().default(true),
  tosLink:            z.string().optional(),
  showCardSection:    z.boolean().default(true),
  image1:             z.string().optional(),
  image2:             z.string().optional(),
  image3:             z.string().optional(),
  image4:             z.string().optional(),
  image5:             z.string().optional(),
  image6:             z.string().optional(),
  review1:            z.string().optional(),
  review1Photo:       z.string().optional(),
  review1Name:        z.string().optional(),
  review2:            z.string().optional(),
  review2Photo:       z.string().optional(),
  review2Name:        z.string().optional(),
  review3:            z.string().optional(),
  review3Photo:       z.string().optional(),
  review3Name:        z.string().optional(),
  review4:            z.string().optional(),
  review4Photo:       z.string().optional(),
  review4Name:        z.string().optional(),
});

export type CustomQuoteData = z.infer<typeof customQuoteDataSchema>;

// ─── GHL Custom Value Key Names (matching Reactivation page) ─────────
const CV = {
  leadFollowupOptions: "lead_followup_options",
  businessLogo:      "homeflow_business_logo",
  companyLogo:       "company_logo",
  businessName:      "homeflow_business_name",
  companyName:       "company_name",
  businessOwnerName: "homeflow_business_owner_name",
  companyDescription:"company_description",
  companyImage:      "company_image",
  quoteTitle:        "quote_title",
  discountOffer:     "discountfree_offer_for_reengagement_campaigns",
  image1:            "image_1",
  image2:            "image_2",
  image3:            "image_3",
  image4:            "image_4",
  image5:            "image_5",
  image6:            "image_6",
  review1:           "review_1",
  review1Photo:      "review_1_photo",
  review1Name:       "review_1_name",
  review2:           "review_2",
  review2Photo:      "review_2_photo",
  review2Name:       "review_2_name",
  review3:           "review_3",
  review3Photo:      "review_3_photo",
  review3Name:       "review_3_name",
  review4:           "review_4",
  review4Photo:      "review_4_photo",
  review4Name:       "review_4_name",
  sendQuoteAutomatically: "send_quote_automatically",
  tosLink:           "tos_link",
  showCardSection:   "show_card_section",
} as const;

  export const requestSchedulingRouter = router({
    getSettings: publicProcedure
      .input(
        z.object({
          locationId: z.string().min(1),
          contactId: z.string().min(1),
        })
      )
      .query(async ({ input }) => {
        const accessToken = await getLocationAccessToken(input.locationId.trim());

        const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(input.contactId.trim())}`, {
          method: "GET",
          headers: ghlHeaders(accessToken),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to load request scheduling settings: ${response.status} ${errorBody}`,
          });
        }

        const data = (await response.json()) as {
          contact?: {
            customFields?: Array<{ id?: string; key?: string; value?: string | number }>;
            tags?: string[];
          };
        };

        const customFields = data.contact?.customFields ?? [];
        const tags = data.contact?.tags ?? [];

        const delayField = customFields.find((field) => field.key === "initial_request_delay");
        const followUpField = customFields.find((field) => field.key === "service_type");

        const delayValue = typeof delayField?.value === "string" ? delayField.value : "";
        const followUpValue = typeof followUpField?.value === "string" ? followUpField.value : String(followUpField?.value ?? "");

        return {
          initialTiming: REVERSE_TIMING_MAP[delayValue] ?? 0,
          followUpCount: Number.parseInt(followUpValue, 10) || 3,
          isPaused: tags.includes("Pause_Reviews"),
        };
      }),

    saveSettings: saveSettingsProcedure,
    // Backwards-compatible alias used by the client bundle and older builds
        saveCustomValuesSettings: publicProcedure
      .input(
        z.object({
          locationId: z.string().min(1),
          leadFollowUpOption: z.enum(["Lite", "S&G Link", "Custom Quote & Link"] as const),
          initialRequestScheduling: z.enum(["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const),
          followUpLimit: z.enum(["0", "1", "2", "3"] as const),
          customQuoteData: customQuoteDataSchema.optional(),
        })
      )
      .mutation(async ({ input }) => {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
        }

        // ── Always-saved base fields ──────────────────────────────────
        const [leadOptionResults, initialResults, followUpResults] = await Promise.all([
          upsertGhlCustomValue(locationId, CV.leadFollowupOptions, input.leadFollowUpOption),
          upsertGhlCustomValue(locationId, "initial_request_scheduling", input.initialRequestScheduling),
          upsertGhlCustomValue(locationId, FOLLOW_UP_CUSTOM_VALUE_NAME, input.followUpLimit),
        ]);

        // ── Custom Quote fields (only when Custom Quote & Link is selected) ──
        if (input.leadFollowUpOption === "Custom Quote & Link" && input.customQuoteData) {
          const d = input.customQuoteData;
          const bio = d.bioText ?? "";

          const quoteUpserts: Array<[string, string]> = [
            // Dual-write: logo
            [CV.businessLogo,      d.businessLogo ?? ""],
            [CV.companyLogo,       d.businessLogo ?? ""],
            // Dual-write: name
            [CV.businessName,      d.businessName ?? ""],
            [CV.companyName,       d.businessName ?? ""],
            // Owner name
            [CV.businessOwnerName, d.businessOwnerName ?? ""],
            // Dual-write: bio → quote_title AND company_description
            [CV.quoteTitle,        bio],
            [CV.companyDescription,bio],
            // Company photo
            [CV.companyImage,      d.companyImage ?? ""],
            // Offer
            [CV.discountOffer,     d.discountOffer ?? ""],
            // Settings
            [CV.sendQuoteAutomatically, d.sendQuoteAutomatically ? "true" : "false"],
            [CV.tosLink,           d.tosLink ?? ""],
            [CV.showCardSection,   d.showCardSection ? "true" : "false"],
            // Gallery images
            [CV.image1, d.image1 ?? ""],
            [CV.image2, d.image2 ?? ""],
            [CV.image3, d.image3 ?? ""],
            [CV.image4, d.image4 ?? ""],
            [CV.image5, d.image5 ?? ""],
            [CV.image6, d.image6 ?? ""],
            // Reviews
            [CV.review1,      d.review1 ?? ""],
            [CV.review1Photo, d.review1Photo ?? ""],
            [CV.review1Name,  d.review1Name ?? ""],
            [CV.review2,      d.review2 ?? ""],
            [CV.review2Photo, d.review2Photo ?? ""],
            [CV.review2Name,  d.review2Name ?? ""],
            [CV.review3,      d.review3 ?? ""],
            [CV.review3Photo, d.review3Photo ?? ""],
            [CV.review3Name,  d.review3Name ?? ""],
            [CV.review4,      d.review4 ?? ""],
            [CV.review4Photo, d.review4Photo ?? ""],
            [CV.review4Name,  d.review4Name ?? ""],
          ];

          await Promise.all(
            quoteUpserts.map(([name, value]) => upsertGhlCustomValue(locationId, name, value))
          );
        }

        return {
          success: true,
          saved: {
            lead_followup_options: leadOptionResults.value,
            initial_request_scheduling: initialResults.value,
            [FOLLOW_UP_CUSTOM_VALUE_NAME]: followUpResults.value,
          },
          results: {
            lead_followup_options: { action: "created_or_updated", id: leadOptionResults.id },
            initial_request_scheduling: { action: "created_or_updated", id: initialResults.id },
            [FOLLOW_UP_CUSTOM_VALUE_NAME]: { action: "created_or_updated", id: followUpResults.id },
          },
        };
      }),
  });
