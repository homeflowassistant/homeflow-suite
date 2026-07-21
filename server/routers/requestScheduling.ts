import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue } from "../ghl-service";
import { ENV } from "../_core/env";

const TIMING_LABEL_TO_INDEX: Record<string, 0 | 1 | 2 | 3 | 4> = {
  immediately: 0,
  "next day": 1,
  "24 hours": 1,
  "24h": 1,
  "48 hours later": 2,
  "48 hours": 2,
  "48h": 2,
  "72 hours later": 3,
  "72 hours": 3,
  "1 week from now": 4,
  "one week from now": 4,
  "1 week": 4,
  "one week": 4,
};

const REVERSE_TIMING_MAP: Record<string, 0 | 1 | 2 | 3 | 4> = {
  immediately: 0,
  "next day": 1,
  "24 hours": 1,
  "48 hours later": 2,
  "72 hours later": 3,
  "1 week from now": 4,
  "one week from now": 4,
  "1 week": 4,
  "one week": 4,
};

const REQUEST_SCHEDULING_LABELS = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;
const FOLLOW_UP_LIMITS = ["0", "1", "2", "3"] as const;
const LEAD_FOLLOW_UP_OPTIONS = ["Lite", "Custom Quote & Link", "S&G Link"] as const;

/**
 * Send S&G Link form data to the configured n8n webhook.
 */
async function sendToN8nWebhook(payload: Record<string, unknown> ): Promise<boolean> {
  if (!ENV.n8nWebhookUrl) {
    console.warn("[S&G Link] N8N_WEBHOOK_URL is not configured. Form data was not sent.");
    return false;
  }

  try {
    const response = await fetch(ENV.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[S&G Link] n8n webhook responded with ${response.status}: ${detail}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[S&G Link] Failed to send data to n8n webhook:", error);
    return false;
  }
}

export const requestSchedulingRouter = router({
  getSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const locationId = input.locationId.trim();
      const customValueMap = await getLocationCustomValueMap(locationId);

      const getCustomValue = (key: string) => {
        let result = "";
        customValueMap.forEach((entry, apiKey) => {
          if (apiKey.toLowerCase() === key.toLowerCase() || apiKey.toLowerCase() === `location.${key.toLowerCase()}`) {
            result = entry.value;
          }
        });
        return result;
      };

      const initialRequestScheduling = getCustomValue("Initial Outreach Scheduling");
      const followUpLimit = getCustomValue("follow_up_limit");
      const leadFollowUpOption = getCustomValue("Lead Follow-up Options (Lite, SG-Link, Custom-Link)");

      return {
        leadFollowUpOption: LEAD_FOLLOW_UP_OPTIONS.includes(leadFollowUpOption as (typeof LEAD_FOLLOW_UP_OPTIONS)[number])
          ? (leadFollowUpOption as (typeof LEAD_FOLLOW_UP_OPTIONS)[number])
          : "Lite",
        initialTiming: TIMING_LABEL_TO_INDEX[initialRequestScheduling.toLowerCase().trim()] ?? REVERSE_TIMING_MAP[initialRequestScheduling] ?? 0,
        followUpCount: FOLLOW_UP_LIMITS.includes(followUpLimit as (typeof FOLLOW_UP_LIMITS)[number])
          ? Number.parseInt(followUpLimit, 10)
          : 3,
      };
    }),

  /**
   * Save custom values to GHL location.
   * When the selected option is "S&G Link", this mutation also accepts
   * an optional `sgLinkData` payload. If provided, it will be forwarded
   * to the configured n8n webhook (N8N_WEBHOOK_URL).
   */
  saveCustomValuesSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1, "Location ID is required"),
        leadFollowUpOption: z.enum(LEAD_FOLLOW_UP_OPTIONS),
        initialRequestScheduling: z.enum(REQUEST_SCHEDULING_LABELS),
        followUpLimit: z.enum(FOLLOW_UP_LIMITS),
        // S&G Link form data — optional, sent when S&G Link is selected
        sgLinkData: z
          .object({
            zipCode: z.string().min(1, "Zip code is required"),
            numberOfDogs: z.string().min(1, "Number of dogs is required"),
            cleanUpFrequency: z.string().min(1, "Clean up frequency is required"),
            lastTimeYardCleaned: z.string().min(1, "Last time yard was cleaned is required"),
            firstName: z.string().min(1, "First name is required"),
            lastName: z.string().optional(),
            cellPhone: z.string().min(1, "Cell phone number is required"),
            email: z.string().min(1, "Email is required"),
            marketingAllowed: z.boolean().default(true),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Location ID cannot be empty",
          });
        }

        const [optionResults, initialResults, followUpResults] = await Promise.all([
          upsertGhlCustomValue(locationId, "Lead Follow-up Options (Lite, SG-Link, Custom-Link)", input.leadFollowUpOption),
          upsertGhlCustomValue(locationId, "Initial Outreach Scheduling", input.initialRequestScheduling),
          upsertGhlCustomValue(locationId, "follow_up_limit", input.followUpLimit),
        ]);

        // If S&G Link is selected and form data is provided, send to n8n webhook
        let webhookSent = false;
        if (input.leadFollowUpOption === "S&G Link" && input.sgLinkData) {
          const webhookPayload = {
            locationId,
            lead_follow_up_option: input.leadFollowUpOption,
            initial_request_scheduling: input.initialRequestScheduling,
            follow_up_limit: input.followUpLimit,
            sg_link_data: {
              zip_code: input.sgLinkData.zipCode,
              number_of_dogs: input.sgLinkData.numberOfDogs,
              clean_up_frequency: input.sgLinkData.cleanUpFrequency,
              last_time_yard_was_cleaned: input.sgLinkData.lastTimeYardCleaned,
              first_name: input.sgLinkData.firstName,
              last_name: input.sgLinkData.lastName ?? "",
              cell_phone: input.sgLinkData.cellPhone,
              email: input.sgLinkData.email,
              marketing_allowed: input.sgLinkData.marketingAllowed,
            },
          };

          webhookSent = await sendToN8nWebhook(webhookPayload);
        }

        return {
          success: true,
          saved: {
            lead_follow_up_option: optionResults.value,
            initial_request_scheduling: initialResults.value,
            follow_up_limit: followUpResults.value,
          },
          webhookSent,
          results: {
            lead_follow_up_option: {
              action: "created_or_updated",
              id: optionResults.id,
            },
            initial_request_scheduling: {
              action: "created_or_updated",
              id: initialResults.id,
            },
            follow_up_limit: {
              action: "created_or_updated",
              id: followUpResults.id,
            },
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("401") || errorMessage.includes("Unauthorized") || errorMessage.includes("token")) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "GHL authentication failed. Your access token may be missing, expired, or lack the required custom values scopes.",
          });
        }

        if (errorMessage.includes("400") || errorMessage.includes("Bad Request")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to save custom values: ${errorMessage}`,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save custom values. Please try again.",
        });
      }
    }),
});
