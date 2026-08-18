import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { getLocationAccessToken } from "../helpers/tokenHelper.js";
import {
  updateExistingCustomValuesOnly,
  fetchAllCustomValues,
  resolveCustomValue as resolveGhlCustomValue,
  uploadToGhlMedia,
} from "../ghl-service.js";

/**
 * Account Set Up router.
 *
 * Persists business profile data entered by the client to GHL location-level
 * custom values, following the same pattern as the Custom Quote popup in the
 * Request Scheduling flow:
 *   - Text fields are written directly to existing custom values.
 *   - Base64 data-URI images are uploaded to the GHL Media Library and the
 *     resulting hosted URL is stored in the custom value.
 *   - Updates are STRICT-UPDATE-ONLY (existing records are PUT in place;
 *     nothing is created) to avoid GHL's "already exists" 400 errors.
 *
 * Field → GHL custom value key mapping (single input updates both keys
 * when two keys share a field, e.g. business name / logo):
 *   Business Name            → homeflow_business_name, company_name
 *   Business Owner Name      → homeflow_business_owner_name
 *   Business Logo (URL/base64) → homeflow_business_logo, company_logo
 *   Payment Link             → add_payment_link
 *   Facebook Page Link       → facebook_page_link
 *   Lead Campaign Offer      → discountfree_offer_for_lead_campaigns
 *   Reengagement Offer       → discountfree_offer_for_reengagement_campaigns
 */

const accountSetupDataSchema = z.object({
  businessName: z.string().trim().max(500).optional(),
  businessOwnerName: z.string().trim().max(500).optional(),
  businessLogo: z.string().optional(), // URL or base64 data URI (goes to BOTH logo keys)
  paymentLink: z.string().trim().max(2000).optional(),
  facebookPageLink: z.string().trim().max(2000).optional(),
  leadCampaignOffer: z.string().trim().max(5000).optional(),
  reengagementOffer: z.string().trim().max(5000).optional(),
});

export type AccountSetupData = z.infer<typeof accountSetupDataSchema>;

// Map each form field to ALL GHL custom value keys it should update.
// Business Name and Business Logo each write to two keys simultaneously,
// exactly as requested in the account setup spec.
const FIELD_KEY_MAP: Record<keyof AccountSetupData, string[]> = {
  businessName: ["homeflow_business_name", "company_name"],
  businessOwnerName: ["homeflow_business_owner_name"],
  businessLogo: ["homeflow_business_logo", "company_logo"],
  paymentLink: ["add_payment_link"],
  facebookPageLink: ["facebook_page_link"],
  leadCampaignOffer: ["discountfree_offer_for_lead_campaigns"],
  reengagementOffer: ["discountfree_offer_for_reengagement_campaigns"],
};

// Order matters: logo upload is processed before the other text updates,
// so the uploaded URL can be written to both logo custom values at once.
const FIELD_ORDER: (keyof AccountSetupData)[] = [
  "businessLogo",
  "businessName",
  "businessOwnerName",
  "paymentLink",
  "facebookPageLink",
  "leadCampaignOffer",
  "reengagementOffer",
];

/**
 * Save a single Account Set Up field (and every custom value key mapped to
 * it) to the GHL subaccount. Auto-save endpoint: no manual Save button.
 *
 * Same image workflow as the Custom Quote popup:
 *   - If the value is a base64 data URI → upload to GHL Media Library → store the URL.
 *   - If it is already a URL or plain text → pass through unchanged.
 */
const saveAccountSetupFieldProcedure = publicProcedure
  .input(
    z.object({
      locationId: z.string().min(1),
      field: z.enum(FIELD_ORDER as [string, ...string[]]),
      value: z.string().optional(),
    })
  )
  .mutation(async ({ input }) => {
    const locationId = input.locationId.trim();
    if (!locationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Location ID cannot be empty",
      });
    }

    const rawValue = input.value ?? "";
    const field = input.field as keyof AccountSetupData;

    let storedValue: string;

    // Upload base64 images to GHL Media Library; pass through URLs/text unchanged
    if (rawValue.startsWith("data:image")) {
      const MIME_TO_EXT: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
      };
      const mimeMatch = rawValue.match(/^data:([A-Za-z-+\/]+);/);
      const ext = mimeMatch ? MIME_TO_EXT[mimeMatch[1]] || ".png" : ".png";
      const fileName = `business_logo_${Date.now()}${ext}`;
      storedValue = await uploadToGhlMedia(locationId, rawValue, fileName);
    } else {
      storedValue = rawValue;
    }

    // STRICT UPDATE ONLY: PUT existing custom values in place; never create
    // new ones. Every key mapped to this field receives the same value.
    const updates: Record<string, string> = {};
    for (const key of FIELD_KEY_MAP[field]) {
      updates[key] = storedValue;
    }
    await updateExistingCustomValuesOnly(locationId, updates);

    return {
      success: true,
      saved: {
        field,
        keys: Object.keys(updates),
        value: storedValue,
      },
      results: Object.fromEntries(
        Object.keys(updates).map(k => [
          k,
          { action: "created_or_updated" as const, id: "updated" },
        ])
      ),
    };
  });

/**
 * Load the latest saved values for all Account Set Up fields from GHL.
 * Empty string means the field is unset; the client keeps its placeholder.
 * One key is read per field (e.g. homeflow_business_logo) and the second
 * key (company_logo) is read separately so the client can surface both.
 */
const getAccountSetupSettingsProcedure = publicProcedure
  .input(z.object({ locationId: z.string().min(1) }))
  .query(async ({ input }) => {
    const locationId = input.locationId.trim();
    const empty = () => "";

    try {
      const accessToken = await getLocationAccessToken(locationId);
      const customValues = await fetchAllCustomValues(locationId, accessToken);

      const get = (key: string): string =>
        resolveGhlCustomValue(customValues, key);

      return {
        businessName: get("homeflow_business_name"),
        companyName: get("company_name"),
        businessOwnerName: get("homeflow_business_owner_name"),
        businessLogo: get("homeflow_business_logo"),
        companyLogo: get("company_logo"),
        paymentLink: get("add_payment_link"),
        facebookPageLink: get("facebook_page_link"),
        leadCampaignOffer: get("discountfree_offer_for_lead_campaigns"),
        reengagementOffer: get("discountfree_offer_for_reengagement_campaigns"),
      };
    } catch (err) {
      console.warn(
        "[GHL] Error fetching Account Set Up settings, returning defaults:",
        err
      );
      return {
        businessName: empty(),
        companyName: empty(),
        businessOwnerName: empty(),
        businessLogo: empty(),
        companyLogo: empty(),
        paymentLink: empty(),
        facebookPageLink: empty(),
        leadCampaignOffer: empty(),
        reengagementOffer: empty(),
      };
    }
  });

export const accountSetupRouter = router({
  saveField: saveAccountSetupFieldProcedure,
  getSettings: getAccountSetupSettingsProcedure,
});
