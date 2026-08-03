import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue, updateExistingCustomValuesOnly, uploadToGhlMedia } from "../ghl-service.js";

// ─── Reactivation campaign option values ─────────────────────────────
// "Lite"              → saved as "Lite"         to lead_followup_options
// "Custom Quote & Link" → saved as "Custom-Link" to lead_followup_options
// (S&G Link is a Follow-Up page concern only; not used here)
const REACTIVATION_OPTIONS = ["Lite", "Custom Quote & Link"] as const;
type ReactivationOption = (typeof REACTIVATION_OPTIONS)[number];

// Maps the UI label to the exact GHL custom value string
const OPTION_TO_GHL_VALUE: Record<ReactivationOption, string> = {
  "Lite": "Lite",
  "Custom Quote & Link": "Custom-Link",
};

// ─── One-Time Service Outreach Scheduling options ─────────────────────
// Mapped to: {{custom_values.onetime_service_reactivation_scheduling}}
const ONETIME_TIMING_LABELS = [
  "Never",
  "Immediately",
  "Next Day",
  "72 Hours Later",
  "1 Week Later",
] as const;
type OnetimeTiming = (typeof ONETIME_TIMING_LABELS)[number];

// ─── Custom value key names (GHL) ─────────────────────────────────────
// IMPORTANT: These are the Reactivation page's own keys only.
// The Follow-Up page (RequestScheduling) has its own separate keys and is
// NOT touched anywhere in this file.
const CV = {
  // Shared option key — written by BOTH pages but with different values
  // Follow-Up page writes: "Lite" | "SG-Link" | "Custom-Link"
  // Reactivation page writes: "Lite" | "Custom-Link"
  leadFollowupOptions: "lead_followup_options",

  // One-Time Service Outreach Scheduling — Reactivation-only key
  onetimeServiceScheduling: "onetime_service_reactivation_scheduling",

  // Shared company fields (also used by Lead Follow-Up page — we only
  // write them when the user explicitly fills the Custom Quote form)
  businessLogo: "homeflow_business_logo",
  companyLogo: "company_logo",
  businessName: "homeflow_business_name",
  companyName: "company_name",
  businessOwnerName: "homeflow_business_owner_name",
  companyDescription: "company_description",
  companyImage: "company_image",

  // Reactivation-specific custom quote fields
  // Bio maps to BOTH quote_title AND company_description (per client spec)
  quoteTitle: "quote_title",
  discountOffer: "discountfree_offer_for_reengagement_campaigns",
  offer2Title: "leads_line_item_2",
  offer2Description: "leads_line_item_description_2",
  offer2Image: "leads_line_item_image_2",
  image1: "image_1",
  image2: "image_2",
  image3: "image_3",
  image4: "image_4",
  image5: "image_5",
  review1: "review_1",
  review1Photo: "review_1_photo",
  review1Name: "review_1_name",
  review2: "review_2",
  review2Photo: "review_2_photo",
  review2Name: "review_2_name",
  review3: "review_3",
  review3Photo: "review_3_photo",
  review3Name: "review_3_name",
  review4: "review_4",
  review4Photo: "review_4_photo",
  review4Name: "review_4_name",
  sendQuoteAutomatically: "send_quote_automatically",
  tosLink: "tos_link",
  showCardSection: "show_card_section",
} as const;

// ─── Normalise a timing label → index ────────────────────────────────
function onetimeTimingToIndex(value: string): number {
  const normalised = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const map: Record<string, number> = {
    never: 0,
    immediately: 1,
    "next day": 2,
    "72 hours later": 3,
    "72 hours": 3,
    "1 week later": 4,
    "one week later": 4,
    "1 week": 4,
  };
  return (
    map[normalised] ??
    ONETIME_TIMING_LABELS.findIndex((l) => l.toLowerCase() === normalised) ??
    0
  );
}

// ─── Zod schema for the Custom Quote form payload ─────────────────────
const customQuoteDataSchema = z.object({
  businessLogo: z.string().optional(),
  businessName: z.string().optional(),
  businessOwnerName: z.string().optional(),
  // Bio text is saved to BOTH quote_title and company_description
  bioText: z.string().optional(),
  companyImage: z.string().optional(),
  discountOffer: z.string().optional(),
  offerDescription: z.string().optional(),
  offer2Title: z.string().optional(),
  offer2Description: z.string().optional(),
  offer2Image: z.string().optional(),
  // Price fields are display-only ($0.00) — still accepted but optional
  offerPricePerVisit: z.string().optional(),
  offerTotal: z.string().optional(),
  offerImage: z.string().optional(),
  sendQuoteAutomatically: z.boolean().default(true),
  tosLink: z.string().optional(),
  showCardSection: z.boolean().default(true),
  image1: z.string().optional(),
  image2: z.string().optional(),
  image3: z.string().optional(),
  image4: z.string().optional(),
  image5: z.string().optional(),
  review1: z.string().optional(),
  review1Photo: z.string().optional(),
  review1Name: z.string().optional(),
  review2: z.string().optional(),
  review2Photo: z.string().optional(),
  review2Name: z.string().optional(),
  review3: z.string().optional(),
  review3Photo: z.string().optional(),
  review3Name: z.string().optional(),
  review4: z.string().optional(),
  review4Photo: z.string().optional(),
  review4Name: z.string().optional(),
});

export type CustomQuoteData = z.infer<typeof customQuoteDataSchema>;

const saveCustomValuesSettingsProcedure = publicProcedure
  .input(
    z.object({
      locationId: z.string().min(1),
      reactivationOption: z.enum(REACTIVATION_OPTIONS),
      onetimeTiming: z.enum(ONETIME_TIMING_LABELS),
      customQuoteData: customQuoteDataSchema.optional(),
    })
  )
  .mutation(async ({ input }) => {
    const locationId = input.locationId.trim();
    if (!locationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
    }

    await updateExistingCustomValuesOnly(locationId, {
      [CV.leadFollowupOptions]: OPTION_TO_GHL_VALUE[input.reactivationOption],
      [CV.onetimeServiceScheduling]: input.onetimeTiming,
    });

    if (input.reactivationOption === "Custom Quote & Link" && input.customQuoteData) {
      const d = input.customQuoteData;

      const MIME_TO_EXT: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
      };

      const handleImg = async (val: string | undefined, name: string): Promise<string> => {
        if (!val) return "";
        if (val.startsWith("data:image")) {
          const mimeMatch = val.match(/^data:([A-Za-z-+\/]+);/);
          const ext = mimeMatch ? (MIME_TO_EXT[mimeMatch[1]] || ".png") : ".png";
          const fileName = `${name}_${Date.now()}${ext}`;
          return await uploadToGhlMedia(locationId, val, fileName);
        }
        return val;
      };

      const [
        businessLogoUrl,
        companyImageUrl,
        img1, img2, img3, img4, img5, img6,
        offer2ImageUrl,
        rev1Photo, rev2Photo, rev3Photo, rev4Photo,
      ] = await Promise.all([
        handleImg(d.businessLogo, "business_logo"),
        handleImg(d.companyImage, "company_image"),
        handleImg(d.image1, "gallery_1"),
        handleImg(d.image2, "gallery_2"),
        handleImg(d.image3, "gallery_3"),
        handleImg(d.image4, "gallery_4"),
        handleImg(d.image5, "gallery_5"),
        handleImg(d.image6, "gallery_6"),
        handleImg(d.offer2Image, "offer_2_image"),
        handleImg(d.review1Photo, "review_1_photo"),
        handleImg(d.review2Photo, "review_2_photo"),
        handleImg(d.review3Photo, "review_3_photo"),
        handleImg(d.review4Photo, "review_4_photo"),
      ]);

      const exactUpdates: Record<string, string> = {
        [CV.companyLogo]: businessLogoUrl,
        "homeflow_business_logo": businessLogoUrl,
        "quote_title": d.quoteTitle ?? "",
        [CV.companyDescription]: d.bioText ?? "",
        [CV.companyImage]: companyImageUrl,
        [CV.offer2Title]: d.offer2Title ?? "2 Weeks FREE",
        [CV.offer2Description]: d.offer2Description ?? "",
        [CV.offer2Image]: offer2ImageUrl,
        [CV.discountOffer]: d.offer2Title ?? "2 Weeks FREE",
        [CV.sendQuoteAutomatically]: d.sendQuoteAutomatically ? "true" : "false",
        [CV.tosLink]: d.tosLink ?? "",
        [CV.showCardSection]: d.showCardSection ? "true" : "false",
        [CV.image1]: img1,
        [CV.image2]: img2,
        [CV.image3]: img3,
        [CV.image4]: img4,
        [CV.image5]: img5,
        "image_6": img6,
        [CV.review1]: d.review1 ?? "",
        [CV.review1Name]: d.review1Name ?? "",
        [CV.review1Photo]: rev1Photo,
        [CV.review2]: d.review2 ?? "",
        [CV.review2Name]: d.review2Name ?? "",
        [CV.review2Photo]: rev2Photo,
        [CV.review3]: d.review3 ?? "",
        [CV.review3Name]: d.review3Name ?? "",
        [CV.review3Photo]: rev3Photo,
        [CV.review4]: d.review4 ?? "",
        [CV.review4Name]: d.review4Name ?? "",
        [CV.review4Photo]: rev4Photo,
      };

      await updateExistingCustomValuesOnly(locationId, exactUpdates);
    }

    return { success: true };
  });

// ─── Router ───────────────────────────────────────────────────────────
export const reactivationRouter = router({
  /**
   * Load current reactivation settings from GHL custom values.
   * Returns the saved option, one-time timing index, and all custom quote fields.
   * Does NOT read or modify any Follow-Up page custom values.
   */
  getSettings: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const customValueMap = await getLocationCustomValueMap(locationId);

      // Case-insensitive lookup helper
      const get = (key: string): string => {
        let result = "";
        customValueMap.forEach((entry, apiKey) => {
          const norm = apiKey.toLowerCase().replace(/^location\./, "");
          if (norm === key.toLowerCase() || apiKey.toLowerCase() === key.toLowerCase()) {
            result = entry.value;
          }
        });
        return result;
      };

      // Derive the reactivation option from the shared lead_followup_options key.
      // Only "Lite" and "Custom-Link" are valid for this page.
      const savedOption = get(CV.leadFollowupOptions);
      let reactivationOption: ReactivationOption = "Lite";
      if (savedOption === "Custom-Link") reactivationOption = "Custom Quote & Link";

      const savedTiming = get(CV.onetimeServiceScheduling);

      return {
        reactivationOption,
        onetimeTiming: onetimeTimingToIndex(savedTiming),
        customQuote: {
          businessLogo: get(CV.businessLogo) || get(CV.companyLogo),
          businessName: get(CV.businessName) || get(CV.companyName),
          businessOwnerName: get(CV.businessOwnerName),
          // Bio is read from company_description (primary source)
          bioText: get(CV.companyDescription),
          companyImage: get(CV.companyImage),
          discountOffer: get(CV.discountOffer),
          offer2Title: get(CV.offer2Title) || get(CV.discountOffer) || "2 Weeks FREE",
          offer2Description: get(CV.offer2Description),
          offer2Image: get(CV.offer2Image),
          sendQuoteAutomatically: get(CV.sendQuoteAutomatically) !== "false",
          tosLink: get(CV.tosLink),
          showCardSection: get(CV.showCardSection) !== "false",
          image1: get(CV.image1),
          image2: get(CV.image2),
          image3: get(CV.image3),
          image4: get(CV.image4),
          image5: get(CV.image5),
          review1: get(CV.review1),
          review1Photo: get(CV.review1Photo),
          review1Name: get(CV.review1Name),
          review2: get(CV.review2),
          review2Photo: get(CV.review2Photo),
          review2Name: get(CV.review2Name),
          review3: get(CV.review3),
          review3Photo: get(CV.review3Photo),
          review3Name: get(CV.review3Name),
          review4: get(CV.review4),
          review4Photo: get(CV.review4Photo),
          review4Name: get(CV.review4Name),
        },
      };
    }),

  /**
   * Save reactivation settings to GHL custom values.
   *
   * Always saves:
   *   - lead_followup_options  → "Lite" | "Custom-Link"
   *   - onetime_service_reactivation_scheduling
   *
   * When "Custom Quote & Link" is selected, also saves all custom quote fields.
   * Bio text is written to BOTH quote_title AND company_description.
   * Logo is written to BOTH homeflow_business_logo AND company_logo.
   * Name is written to BOTH homeflow_business_name AND company_name.
   *
   * The Follow-Up page (RequestScheduling) is NOT touched.
   */
  saveSettings: saveCustomValuesSettingsProcedure,
  saveCustomValuesSettings: saveCustomValuesSettingsProcedure,
});
