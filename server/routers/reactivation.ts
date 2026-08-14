import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { getLocationAccessToken } from "../helpers/tokenHelper.js";
import {
  getCustomFieldIdByName,
  upsertGhlCustomValue,
  uploadToGhlMedia,
  updateExistingCustomValuesOnly,
  fetchAllCustomValues,
  findCustomValueId,
  resolveCustomValue as resolveGhlCustomValue,
  extractCustomValueKey,
} from "../ghl-service.js";

const FOLLOW_UP_CUSTOM_VALUE_NAME =
  "08. How Many Times Should We Follow-Up For A Review? (0, 1, 2, or 3)";

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
  const initialDelayFieldId = await getCustomFieldIdByName(
    locationId,
    "initial_request_delay"
  );
  const followUpLimitFieldId = await getCustomFieldIdByName(
    locationId,
    "service_type"
  );

  if (!initialDelayFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Custom field 'initial_request_delay' not found in your GHL account. Please create this field in Settings > Custom Fields.",
    });
  }

  if (!followUpLimitFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Custom field 'service_type' ({{custom_values.service_type}}) not found in your GHL account. Please create this field in Settings > Custom Fields.",
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
    const { initialDelayFieldId, followUpLimitFieldId } =
      await getRequestSchedulingFieldIds(input.locationId.trim());
    const accessToken = await getLocationAccessToken(input.locationId.trim());
    const contactId = input.contactId.trim();

    await fetch(
      `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`,
      {
        method: "PUT",
        headers: ghlHeaders(accessToken),
        body: JSON.stringify({
          customFields: [
            {
              id: initialDelayFieldId,
              key: "initial_request_delay",
              field_value:
                TIMING_MAP[input.initialTiming as keyof typeof TIMING_MAP],
            },
            {
              id: followUpLimitFieldId,
              key: "service_type",
              field_value: input.followUpCount,
            },
          ],
        }),
      }
    ).then(async response => {
      if (!response.ok) {
        const errorBody = await response.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to update request scheduling settings: ${response.status} ${errorBody}`,
        });
      }
    });

    if (input.isPaused) {
      const response = await fetch(
        `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`,
        {
          method: "POST",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to add Pause_Reviews tag: ${response.status} ${errorBody}`,
        });
      }
    } else {
      const response = await fetch(
        `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`,
        {
          method: "DELETE",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        }
      );

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
  businessLogo: z.string().optional(),
  quoteTitle: z.string().optional(),
  bioText: z.string().optional(),
  companyImage: z.string().optional(),
  // Offer 1 (Leads Line Item 1)
  offer1Title: z.string().optional(),
  offer1Description: z.string().optional(),
  offer1Image: z.string().optional(),
  // Offer 2 (Leads Line Item 2)
  offer2Title: z.string().optional(),
  offer2Description: z.string().optional(),
  offer2Image: z.string().optional(),
  sendQuoteAutomatically: z.boolean().default(true),
  tosLink: z.string().optional(),
  showCardSection: z.boolean().default(true),
  // Gallery Images
  image1: z.string().optional(),
  image2: z.string().optional(),
  image3: z.string().optional(),
  image4: z.string().optional(),
  image5: z.string().optional(),
  image6: z.string().optional(),
  // Testimonials
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

// ─── GHL Custom Value Key Names (Custom Quote popup) ────────────────
const CV = {
  companyName: "company_name",
  leadFollowupOptions: "lead_followup_options",
  companyLogo: "company_logo",
  companyDescription: "company_description",
  companyImage: "company_image",
  quoteTitle: "quote_title",
  // Offer 1 (Leads Line Item 1)
  offer1Title: "leads_line_item_1",
  offer1Description: "leads_line_item_description_1",
  offer1Image: "leads_line_item_image_1",
  // Offer 2 (Leads Line Item 2)
  offer2Title: "leads_line_item_2",
  offer2Description: "leads_line_item_description_2",
  offer2Image: "leads_line_item_image_2",
  // Gallery Images
  image1: "image_1",
  image2: "image_2",
  image3: "image_3",
  image4: "image_4",
  image5: "image_5",
  image6: "image_6",
  // Testimonials
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
  // Page Settings
  sendQuoteAutomatically: "send_quote_automatically",
  tosLink: "tos_link",
  showCardSection: "show_card_section",
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

      const response = await fetch(
        `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(input.contactId.trim())}`,
        {
          method: "GET",
          headers: ghlHeaders(accessToken),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to load request scheduling settings: ${response.status} ${errorBody}`,
        });
      }

      const data = (await response.json()) as {
        contact?: {
          customFields?: Array<{
            id?: string;
            key?: string;
            value?: string | number;
          }>;
          tags?: string[];
        };
      };

      const customFields = data.contact?.customFields ?? [];
      const tags = data.contact?.tags ?? [];

      const delayField = customFields.find(
        field => field.key === "initial_request_delay"
      );
      const followUpField = customFields.find(
        field => field.key === "service_type"
      );

      const delayValue =
        typeof delayField?.value === "string" ? delayField.value : "";
      const followUpValue =
        typeof followUpField?.value === "string"
          ? followUpField.value
          : String(followUpField?.value ?? "");

      return {
        initialTiming: REVERSE_TIMING_MAP[delayValue] ?? 0,
        followUpCount: Number.parseInt(followUpValue, 10) || 3,
        isPaused: tags.includes("Pause_Reviews"),
      };
    }),

  getLocationSettings: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const accessToken = await getLocationAccessToken(locationId);

      let customValues: Record<string, unknown>[] = [];
      try {
        customValues = await fetchAllCustomValues(locationId, accessToken);
      } catch (err) {
        console.warn(
          "[GHL] Error fetching location custom values for settings:",
          err
        );
      }

      // Map lead_followup_options value
      const leadOptionId =
        findCustomValueId(customValues, CV.leadFollowupOptions) ||
        findCustomValueId(
          customValues,
          "Lead Follow-up Options (Lite, SG-Link, Custom-Link)"
        );
      const leadOptionCv = customValues.find(
        cv => (cv.id || cv._id) === leadOptionId
      );
      const rawOptVal = String(leadOptionCv?.value || "").trim();

      let leadFollowUpOption: "Lite" | "S&G Link" | "Custom Quote & Link" =
        "Lite";
      if (rawOptVal === "Custom-Link" || rawOptVal === "Custom Quote & Link") {
        leadFollowUpOption = "Custom Quote & Link";
      } else if (rawOptVal === "SG-Link" || rawOptVal === "S&G Link") {
        leadFollowUpOption = "S&G Link";
      } else if (rawOptVal === "Lite") {
        leadFollowUpOption = "Lite";
      }

      // Map initial_request_scheduling value
      const initialId = findCustomValueId(
        customValues,
        "initial_request_scheduling"
      );
      const initialCv = customValues.find(
        cv => (cv.id || cv._id) === initialId
      );
      const initialRequestScheduling = String(
        initialCv?.value || "72 Hours Later"
      ).trim();

      // Map follow_up_limit value
      const followUpId = findCustomValueId(
        customValues,
        FOLLOW_UP_CUSTOM_VALUE_NAME
      );
      const followUpCv = customValues.find(
        cv => (cv.id || cv._id) === followUpId
      );
      const followUpLimit = String(followUpCv?.value || "3").trim();

      return {
        leadFollowUpOption,
        initialRequestScheduling,
        followUpLimit,
      };
    }),

  /**
   * Load the latest GHL custom values for every field of the
   * Custom Quote popup. Called every time the popup opens so all
   * fields are pre-filled with the freshest saved values from GHL.
   * Empty strings mean the value is missing/unavailable; the client
   * then falls back to its existing/default value for that field.
   */
  getQuoteSettings: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const empty = () => "";

      try {
        const customValues = await fetchAllCustomValues(
          locationId,
          await getLocationAccessToken(locationId)
        );

        // Unified lookup: unwraps GHL's `{{ custom_values.xxx }}` fieldKey
        // syntax, then matches case-insensitive / normalized / fuzzy. An
        // empty string means the field is missing or its stored value is
        // empty — the client falls back to the default value for that
        // field, so GHL custom values always take priority over defaults.
        const get = (key: string): string =>
          resolveGhlCustomValue(customValues, key);

        return {
          companyName: get(CV.companyName),
          companyLogo: get(CV.companyLogo) || get("homeflow_business_logo"),
          companyDescription: get(CV.companyDescription),
          companyImage: get(CV.companyImage),
          quoteTitle: get(CV.quoteTitle),
          offer1Title: get(CV.offer1Title),
          offer1Description: get(CV.offer1Description),
          offer1Image: get(CV.offer1Image),
          offer2Title: get(CV.offer2Title),
          offer2Description: get(CV.offer2Description),
          offer2Image: get(CV.offer2Image),
          image1: get(CV.image1),
          image2: get(CV.image2),
          image3: get(CV.image3),
          image4: get(CV.image4),
          image5: get(CV.image5),
          image6: get(CV.image6),
          tosLink: get(CV.tosLink),
          review1: get(CV.review1),
          review1Name: get(CV.review1Name),
          review1Photo: get(CV.review1Photo),
          review2: get(CV.review2),
          review2Name: get(CV.review2Name),
          review2Photo: get(CV.review2Photo),
          review3: get(CV.review3),
          review3Name: get(CV.review3Name),
          review3Photo: get(CV.review3Photo),
          review4: get(CV.review4),
          review4Name: get(CV.review4Name),
          review4Photo: get(CV.review4Photo),
        };
      } catch (err) {
        console.warn(
          "[GHL] Error fetching custom quote settings, returning defaults:",
          err
        );
        return {
          companyName: empty(),
          companyLogo: empty(),
          companyDescription: empty(),
          companyImage: empty(),
          quoteTitle: empty(),
          offer1Title: empty(),
          offer1Description: empty(),
          offer1Image: empty(),
          offer2Title: empty(),
          offer2Description: empty(),
          offer2Image: empty(),
          image1: empty(),
          image2: empty(),
          image3: empty(),
          image4: empty(),
          image5: empty(),
          image6: empty(),
          tosLink: empty(),
          review1: empty(),
          review1Name: empty(),
          review1Photo: empty(),
          review2: empty(),
          review2Name: empty(),
          review2Photo: empty(),
          review3: empty(),
          review3Name: empty(),
          review3Photo: empty(),
          review4: empty(),
          review4Name: empty(),
          review4Photo: empty(),
        };
      }
    }),

  /**
   * List every custom value available in the current GHL subaccount
   * (location), so the Custom Quote popup can offer a picker that
   * inserts `{{custom_values.<key>}}` tags into text fields.
   * Also includes the standard built-in placeholders (company name,
   * service area, etc.) used by the quote templates.
   */
  getCustomValueTags: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const builtIn = [
        { name: "Company Name", tag: "{{custom_values.company_name}}" },
        { name: "Account Details", tag: "{{custom_values.account_details}}" },
        { name: "Service Area", tag: "{{custom_values.service_area}}" },
      ];
      try {
        const customValues = await fetchAllCustomValues(
          locationId,
          await getLocationAccessToken(locationId)
        );
        const custom = customValues.map(c => {
          // Unwrap GHL's `{{ custom_values.xxx }}` fieldKey syntax so the
          // raw key (e.g. "lead_followup_options") is what gets exposed to
          // the client picker.
          const unwrapped =
            typeof c.fieldKey === "string" && c.fieldKey
              ? extractCustomValueKey(c.fieldKey)
              : undefined;
          const rawKey = unwrapped;
          const keyCandidate =
            (typeof c.key === "string" && c.key) || rawKey;
          const nameCandidate =
            (typeof c.name === "string" && c.name) ||
            rawKey ||
            (typeof c.fieldKey === "string" && c.fieldKey) ||
            "unnamed";
          const keyStr = keyCandidate || nameCandidate;
          const tagKey = keyStr
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_|_$/g, "");
          return {
            name: nameCandidate,
            key: keyStr,
            tag: `{{custom_values.${tagKey}}}`,
          };
        });
        return { tags: [...builtIn, ...custom] };
      } catch (err) {
        console.warn("[GHL] Error listing custom value tags:", err);
        return { tags: builtIn };
      }
    }),

  /**
   * Resolve a selected custom value to its actual (current) value in
   * the GHL subaccount. Used by the Company Description picker: when
   * the user picks a custom value, the popup fetches its live value
   * here and inserts that real text instead of the raw `{{...}}` tag.
   * For the three built-in placeholders the resolved text is returned
   * from the same GHL custom values lookup, falling back to the tag
   * itself when no value is stored.
   */
  resolveCustomValue: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        key: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const key = input.key.trim();
      const normalized = key
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_|_$/g, "");

      try {
        const customValues = await fetchAllCustomValues(
          locationId,
          await getLocationAccessToken(locationId)
        );
        // Unified lookup: unwraps `{{ custom_values.xxx }}` fieldKey syntax
        // and falls back to fuzzy matching, so any picker key resolves to
        // the live stored value.
        const resolved = resolveGhlCustomValue(customValues, normalized);
        // If the subaccount has no stored value, surface the tag itself
        // so the user can see what was inserted (template placeholder).
        return {
          value:
            resolved || `{{custom_values.${normalized || "unknown"}}}`,
          isPlaceholder: resolved === "",
        };
      } catch (err) {
        console.warn("[GHL] Error resolving custom value:", err);
        return {
          value: `{{custom_values.${normalized || "unknown"}}}`,
          isPlaceholder: true,
        };
      }
    }),

  saveSettings: saveSettingsProcedure,
  // Backwards-compatible alias used by the client bundle and older builds
  saveCustomValuesSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        leadFollowUpOption: z.enum([
          "Lite",
          "S&G Link",
          "Custom Quote & Link",
        ] as const),
        initialRequestScheduling: z.enum([
          "Immediately",
          "Next Day",
          "48 Hours Later",
          "72 Hours Later",
          "One Week from Now",
        ] as const),
        followUpLimit: z.enum(["0", "1", "2", "3"] as const),
        customQuoteData: customQuoteDataSchema.optional(),
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

      // ── Always-saved base fields ──────────────────────────────────
      // STRICT UPDATE ONLY: We do not want to ever POST/create these base fields,
      // because doing so causes the 400 "already exists" error if the name/key matching fails.
      // We will strictly PUT to the existing keys.
      await updateExistingCustomValuesOnly(locationId, {
        [CV.leadFollowupOptions]: input.leadFollowUpOption,
        initial_request_scheduling: input.initialRequestScheduling,
        [FOLLOW_UP_CUSTOM_VALUE_NAME]: input.followUpLimit,
      });

      // We no longer return the created IDs, because we only updated existing ones.
      const leadOptionResults = {
        value: input.leadFollowUpOption,
        id: "updated",
      };
      const initialResults = {
        value: input.initialRequestScheduling,
        id: "updated",
      };
      const followUpResults = { value: input.followUpLimit, id: "updated" };

      // ── Custom Quote fields (only when Custom Quote & Link is selected) ──
      if (
        input.leadFollowUpOption === "Custom Quote & Link" &&
        input.customQuoteData
      ) {
        const d = input.customQuoteData;

        // Upload any base64 images to GHL Media Library; pass through existing URLs unchanged
        const MIME_TO_EXT: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/jpg": ".jpg",
          "image/webp": ".webp",
          "image/gif": ".gif",
          "image/svg+xml": ".svg",
        };

        const handleImg = async (
          val: string | undefined,
          name: string
        ): Promise<string> => {
          if (!val) return "";
          if (val.startsWith("data:image")) {
            // Extract MIME type from the data URI and pick the correct extension
            const mimeMatch = val.match(/^data:([A-Za-z-+\/]+);/);
            const ext = mimeMatch
              ? MIME_TO_EXT[mimeMatch[1]] || ".png"
              : ".png";
            const fileName = `${name}_${Date.now()}${ext}`;
            return await uploadToGhlMedia(locationId, val, fileName);
          }
          // Already a URL — return as-is
          return val;
        };

        // Upload all images concurrently
        const [
          businessLogoUrl,
          companyImageUrl,
          img1,
          img2,
          img3,
          img4,
          img5,
          img6,
          offer1ImageUrl,
          offer2ImageUrl,
          rev1Photo,
          rev2Photo,
          rev3Photo,
          rev4Photo,
        ] = await Promise.all([
          handleImg(d.businessLogo, "business_logo"),
          handleImg(d.companyImage, "company_image"),
          handleImg(d.image1, "gallery_1"),
          handleImg(d.image2, "gallery_2"),
          handleImg(d.image3, "gallery_3"),
          handleImg(d.image4, "gallery_4"),
          handleImg(d.image5, "gallery_5"),
          handleImg(d.image6, "gallery_6"),
          handleImg(d.offer1Image, "offer_1_image"),
          handleImg(d.offer2Image, "offer_2_image"),
          handleImg(d.review1Photo, "review_1_photo"),
          handleImg(d.review2Photo, "review_2_photo"),
          handleImg(d.review3Photo, "review_3_photo"),
          handleImg(d.review4Photo, "review_4_photo"),
        ]);

        // Exact custom value keys — strictly update existing, never create new
        // Maps every popup field to its corresponding GHL Custom Value key
        const exactUpdates: Record<string, string> = {
          // Business Information
          [CV.companyLogo]: businessLogoUrl,
          homeflow_business_logo: businessLogoUrl,
          quote_title: d.quoteTitle ?? "",
          [CV.companyDescription]: d.bioText ?? "",
          [CV.companyImage]: companyImageUrl,

          // Offer 1 (Leads Line Item 1)
          [CV.offer1Title]: d.offer1Title ?? "[FREQUENCY] | Dog Waste Removal",
          [CV.offer1Description]: d.offer1Description ?? "",
          [CV.offer1Image]: offer1ImageUrl,

          // Offer 2 (Leads Line Item 2 & Freebie Offer)
          [CV.offer2Title]: d.offer2Title ?? "2 Weeks FREE",
          [CV.offer2Description]: d.offer2Description ?? "",
          [CV.offer2Image]: offer2ImageUrl,
          discountfree_offer_for_reengagement_campaigns:
            d.offer2Title ?? "2 Weeks FREE",

          // Page Settings
          [CV.sendQuoteAutomatically]: d.sendQuoteAutomatically
            ? "true"
            : "false",
          [CV.tosLink]: d.tosLink ?? "",
          [CV.showCardSection]: d.showCardSection ? "true" : "false",

          // Gallery Images (uploaded to GHL Media Library → hosted URL stored)
          [CV.image1]: img1,
          [CV.image2]: img2,
          [CV.image3]: img3,
          [CV.image4]: img4,
          [CV.image5]: img5,
          [CV.image6]: img6,

          // Testimonials
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

      return {
        success: true,
        saved: {
          lead_followup_options: leadOptionResults.value,
          initial_request_scheduling: initialResults.value,
          [FOLLOW_UP_CUSTOM_VALUE_NAME]: followUpResults.value,
        },
        results: {
          lead_followup_options: {
            action: "created_or_updated",
            id: leadOptionResults.id,
          },
          initial_request_scheduling: {
            action: "created_or_updated",
            id: initialResults.id,
          },
          [FOLLOW_UP_CUSTOM_VALUE_NAME]: {
            action: "created_or_updated",
            id: followUpResults.id,
          },
        },
      };
    }),

  /**
   * Load the latest GHL custom value for the S&G Link base onboarding link.
   * Called every time the popup opens so the field is pre-filled with the
   * freshest saved value for the current sub-account. An empty string means
   * the value is missing/unavailable; the client then falls back to its
   * existing/default value.
   */
  getSgLinkSettings: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      try {
        const customValues = await fetchAllCustomValues(
          locationId,
          await getLocationAccessToken(locationId)
        );
        // Unified lookup: unwraps GHL's `{{ custom_values.base_onboarding_link }}`
        // syntax, then matches case-insensitive / normalized / fuzzy.
        return {
          baseOnboardingLink: resolveGhlCustomValue(
            customValues,
            "base_onboarding_link"
          ),
        };
      } catch (err) {
        console.warn(
          "[GHL] Error fetching S&G link setting, returning default:",
          err
        );
        return { baseOnboardingLink: "" };
      }
    }),

  /**
   * Save S&G Link base onboarding link to GHL custom value.
   * Saves to: base_onboarding_link (accessible via {{custom_values.base_onboarding_link}})
   */
  saveSgLinkSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        baseOnboardingLink: z
          .string()
          .min(1, "Base onboarding link is required"),
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
