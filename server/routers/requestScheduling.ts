import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { getLocationAccessToken } from "../helpers/tokenHelper.js";
import { getCustomFieldIdByName, upsertGhlCustomValue, uploadToGhlMedia, updateExistingCustomValuesOnly } from "../ghl-service.js";

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
  quoteTitle:         z.string().optional(),
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
        // STRICT UPDATE ONLY: We do not want to ever POST/create these base fields,
        // because doing so causes the 400 "already exists" error if the name/key matching fails.
        // We will strictly PUT to the existing keys.
        await updateExistingCustomValuesOnly(locationId, {
          [CV.leadFollowupOptions]: input.leadFollowUpOption,
          "initial_request_scheduling": input.initialRequestScheduling,
          [FOLLOW_UP_CUSTOM_VALUE_NAME]: input.followUpLimit,
        });

        // We no longer return the created IDs, because we only updated existing ones.
        const leadOptionResults = { value: input.leadFollowUpOption, id: "updated" };
        const initialResults = { value: input.initialRequestScheduling, id: "updated" };
        const followUpResults = { value: input.followUpLimit, id: "updated" };

        // ── Custom Quote fields (only when Custom Quote & Link is selected) ──
        if (input.leadFollowUpOption === "Custom Quote & Link" && input.customQuoteData) {
          const d = input.customQuoteData;

          // Upload any base64 images to GHL Media Library; pass through existing URLs unchanged
          const handleImg = async (val: string | undefined, name: string): Promise<string> => {
            if (!val) return "";
            if (val.startsWith("data:image")) {
              return await uploadToGhlMedia(locationId, val, `${name}_${Date.now()}.png`);
            }
            return val;
          };

          // Upload all images concurrently
          const [
            businessLogoUrl,
            companyImageUrl,
            img1, img2, img3, img4, img5,
            rev1Photo, rev2Photo, rev3Photo, rev4Photo,
          ] = await Promise.all([
            handleImg(d.businessLogo,    "business_logo"),
            handleImg(d.companyImage,    "company_image"),
            handleImg(d.image1,          "gallery_1"),
            handleImg(d.image2,          "gallery_2"),
            handleImg(d.image3,          "gallery_3"),
            handleImg(d.image4,          "gallery_4"),
            handleImg(d.image5,          "gallery_5"),
            handleImg(d.review1Photo,    "review_1_photo"),
            handleImg(d.review2Photo,    "review_2_photo"),
            handleImg(d.review3Photo,    "review_3_photo"),
            handleImg(d.review4Photo,    "review_4_photo"),
          ]);

          // Exact custom value keys — strictly update existing, never create new
          const exactUpdates: Record<string, string> = {
            "homeflow_business_logo":                           businessLogoUrl,
            "homeflow_business_name":                           d.businessName ?? "",
            "homeflow_business_owner_name":                     d.businessOwnerName ?? "",
            "quote_title":                                      d.quoteTitle ?? "[service area]'s Highest Rated Pooper Scooper Service",
            "company_description":                              d.bioText ?? "",
            "company_image":                                    companyImageUrl,
            "discountfree_offer_for_reengagement_campaigns":    d.discountOffer ?? "",
            "send_quote_automatically":                         d.sendQuoteAutomatically ? "true" : "false",
            "tos_link":                                         d.tosLink ?? "",
            "show_card_section":                                d.showCardSection ? "true" : "false",
            "image_1":                                          img1,
            "image_2":                                          img2,
            "image_3":                                          img3,
            "image_4":                                          img4,
            "image_5":                                          img5,
            "review_1":                                         d.review1 ?? "",
            "review_1_name":                                    d.review1Name ?? "",
            "review_1_photo":                                   rev1Photo,
            "review_2":                                         d.review2 ?? "",
            "review_2_name":                                    d.review2Name ?? "",
            "review_2_photo":                                   rev2Photo,
            "review_3":                                         d.review3 ?? "",
            "review_3_name":                                    d.review3Name ?? "",
            "review_3_photo":                                   rev3Photo,
            "review_4":                                         d.review4 ?? "",
            "review_4_name":                                    d.review4Name ?? "",
            "review_4_photo":                                   rev4Photo,
          };

          await updateExistingCustomValuesOnly(locationId, exactUpdates);
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

    /**
     * Save S&G Link base onboarding link to GHL custom value.
     * Saves to: base_onboarding_link (accessible via {{custom_values.base_onboarding_link}})
     */
    saveSgLinkSettings: publicProcedure
      .input(
        z.object({
          locationId: z.string().min(1),
          baseOnboardingLink: z.string().min(1, "Base onboarding link is required"),
        })
      )
      .mutation(async ({ input }) => {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
        }

        const result = await upsertGhlCustomValue(
          locationId,
          "base_onboarding_link",
          input.baseOnboardingLink.trim()
        );

        return {
          success: true,
          saved: {
            base_onboarding_link: result.value,
          },
          results: {
            base_onboarding_link: { action: "created_or_updated", id: result.id },
          },
        };
      }),
  });
