import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue } from "../ghl-service";

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
  businessLogo:      "homeflow_business_logo",
  companyLogo:       "company_logo",
  businessName:      "homeflow_business_name",
  companyName:       "company_name",
  businessOwnerName: "homeflow_business_owner_name",
  companyDescription:"company_description",
  companyImage:      "company_image",

  // Reactivation-specific custom quote fields
  // Bio maps to BOTH quote_title AND company_description (per client spec)
  quoteTitle:        "quote_title",
  discountOffer:     "discountfree_offer_for_reengagement_campaigns",
  image1:            "image_1",
  image2:            "image_2",
  image3:            "image_3",
  image4:            "image_4",
  image5:            "image_5",
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

// ─── Normalise a timing label → index ────────────────────────────────
function onetimeTimingToIndex(value: string): number {
  const normalised = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const map: Record<string, number> = {
    never:          0,
    immediately:    1,
    "next day":     2,
    "72 hours later": 3,
    "72 hours":     3,
    "1 week later": 4,
    "one week later": 4,
    "1 week":       4,
  };
  return (
    map[normalised] ??
    ONETIME_TIMING_LABELS.findIndex((l) => l.toLowerCase() === normalised) ??
    0
  );
}

// ─── Zod schema for the Custom Quote form payload ─────────────────────
const customQuoteDataSchema = z.object({
  businessLogo:       z.string().optional(),
  businessName:       z.string().min(1, "Business name is required"),
  businessOwnerName:  z.string().optional(),
  // Bio text is saved to BOTH quote_title and company_description
  bioText:            z.string().optional(),
  companyImage:       z.string().optional(),
  discountOffer:      z.string().optional(),
  offerDescription:   z.string().optional(),
  // Price fields are display-only ($0.00) — still accepted but optional
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
          businessLogo:       get(CV.businessLogo) || get(CV.companyLogo),
          businessName:       get(CV.businessName) || get(CV.companyName),
          businessOwnerName:  get(CV.businessOwnerName),
          // Bio is read from company_description (primary source)
          bioText:            get(CV.companyDescription),
          companyImage:       get(CV.companyImage),
          discountOffer:      get(CV.discountOffer),
          sendQuoteAutomatically: get(CV.sendQuoteAutomatically) !== "false",
          tosLink:            get(CV.tosLink),
          showCardSection:    get(CV.showCardSection) !== "false",
          image1:  get(CV.image1),
          image2:  get(CV.image2),
          image3:  get(CV.image3),
          image4:  get(CV.image4),
          image5:  get(CV.image5),
          review1:      get(CV.review1),
          review1Photo: get(CV.review1Photo),
          review1Name:  get(CV.review1Name),
          review2:      get(CV.review2),
          review2Photo: get(CV.review2Photo),
          review2Name:  get(CV.review2Name),
          review3:      get(CV.review3),
          review3Photo: get(CV.review3Photo),
          review3Name:  get(CV.review3Name),
          review4:      get(CV.review4),
          review4Photo: get(CV.review4Photo),
          review4Name:  get(CV.review4Name),
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
  saveSettings: publicProcedure
    .input(
      z.object({
        locationId:          z.string().min(1, "Location ID is required"),
        reactivationOption:  z.enum(REACTIVATION_OPTIONS),
        onetimeTiming:       z.enum(ONETIME_TIMING_LABELS),
        customQuoteData:     customQuoteDataSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
        }

        // ── Always-saved base fields ──────────────────────────────────
        await Promise.all([
          upsertGhlCustomValue(
            locationId,
            CV.leadFollowupOptions,
            OPTION_TO_GHL_VALUE[input.reactivationOption]
          ),
          upsertGhlCustomValue(
            locationId,
            CV.onetimeServiceScheduling,
            input.onetimeTiming
          ),
        ]);

        // ── Custom Quote fields ───────────────────────────────────────
        if (input.reactivationOption === "Custom Quote & Link" && input.customQuoteData) {
          const d = input.customQuoteData;
          const bio = d.bioText ?? "";

          const quoteUpserts: Array<[string, string]> = [
            // Dual-write: logo
            [CV.businessLogo,      d.businessLogo ?? ""],
            [CV.companyLogo,       d.businessLogo ?? ""],
            // Dual-write: name
            [CV.businessName,      d.businessName],
            [CV.companyName,       d.businessName],
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

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const msg = error instanceof Error ? error.message : "Unknown error";
        if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("token")) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "GHL authentication failed. Your access token may be missing or expired.",
          });
        }
        if (msg.includes("400") || msg.includes("Bad Request")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Failed to save: ${msg}` });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save reactivation settings. Please try again.",
        });
      }
    }),
});
