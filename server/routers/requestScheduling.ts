import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue } from "../ghl-service";

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
const LEAD_FOLLOW_UP_OPTIONS = ["Lite", "S&G Link"] as const;

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
        for (const [apiKey, entry] of customValueMap.entries()) {
          if (apiKey.toLowerCase() === key.toLowerCase() || apiKey.toLowerCase() === `location.${key.toLowerCase()}`) {
            return entry.value;
          }
        }
        return "";
      };

      const initialRequestScheduling = getCustomValue("initial_request_scheduling");
      const followUpLimit = getCustomValue("follow_up_limit");
      const leadFollowUpOption = getCustomValue("lead_follow_up_option");

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
   * Maps UI slider values to GHL custom value names and values.
   * initialTiming: 0-3 → "Within 24 Hours", "24 Hours", "48 Hours", "1 Week"
   * followUpCount: 0-3 → "0", "1", "2", "3"
   */
  saveCustomValuesSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1, "Location ID is required"),
        leadFollowUpOption: z.enum(LEAD_FOLLOW_UP_OPTIONS),
        initialRequestScheduling: z.enum(REQUEST_SCHEDULING_LABELS),
        followUpLimit: z.enum(FOLLOW_UP_LIMITS),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Validate inputs are properly formatted
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Location ID cannot be empty",
          });
        }
        // Upsert custom values using the backend helper which resolves existing IDs automatically.
        const [optionResults, initialResults, followUpResults] = await Promise.all([
          upsertGhlCustomValue(locationId, "lead_follow_up_option", input.leadFollowUpOption),
          upsertGhlCustomValue(locationId, "initial_request_scheduling", input.initialRequestScheduling),
          upsertGhlCustomValue(locationId, "follow_up_limit", input.followUpLimit),
        ]);

        return {
          success: true,
          saved: {
            lead_follow_up_option: optionResults.value,
            initial_request_scheduling: initialResults.value,
            follow_up_limit: followUpResults.value,
          },
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
        // Handle GHL API errors
        if (error instanceof TRPCError) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        // Provide actionable error messages
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
