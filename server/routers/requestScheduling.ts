import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationAccessToken } from "../helpers/tokenHelper";
import { upsertGhlCustomValue } from "../ghl-service";

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
      const followUpField = customFields.find((field) => field.key === "follow_up_limit");

      const delayValue = typeof delayField?.value === "string" ? delayField.value : "";
      const followUpValue = typeof followUpField?.value === "string" ? followUpField.value : String(followUpField?.value ?? "");

      return {
        initialTiming: REVERSE_TIMING_MAP[delayValue] ?? 0,
        followUpCount: Number.parseInt(followUpValue, 10) || 3,
        isPaused: tags.includes("Pause_Reviews"),
      };
    }),

  saveSettings: publicProcedure
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
      const locationId = input.locationId.trim();
      const contactId = input.contactId.trim();

      try {
        // Save request scheduling as location-level custom values
        // (These are accessible via {{custom_values.initial_request_scheduling}} in GHL templates)
        const delayValue = TIMING_MAP[input.initialTiming];
        const followUpValue = String(input.followUpCount);

        await Promise.all([
          upsertGhlCustomValue(locationId, "initial_request_scheduling", delayValue),
          upsertGhlCustomValue(locationId, "follow_up_limit", followUpValue),
        ]);
      } catch (error) {
        console.error("[requestScheduling.saveSettings] Error saving custom values:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save request scheduling values: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }

      // Handle pause/resume tag on the contact
      const accessToken = await getLocationAccessToken(locationId);

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
        initialRequestScheduling: z.enum(["Within 24 Hours", "24 Hours", "48 Hours", "1 Week"], {
          errorMap: () => ({ message: 'initialRequestScheduling must be one of: "Within 24 Hours", "24 Hours", "48 Hours", "1 Week"' }),
        }),
        serviceType: z.enum(["0", "1", "2", "3"], {
          errorMap: () => ({ message: 'serviceType must be one of: "0", "1", "2", "3"' }),
        }),
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

        // Upsert both custom values
        const [initialResults, serviceResults] = await Promise.all([
          upsertGhlCustomValue(locationId, "initial_request_scheduling", input.initialRequestScheduling),
          upsertGhlCustomValue(locationId, "service_type", input.serviceType),
        ]);

        return {
          success: true,
          saved: {
            initial_request_scheduling: initialResults.value,
            service_type: serviceResults.value,
          },
          results: {
            initial_request_scheduling: {
              action: "created_or_updated",
              id: initialResults.id,
            },
            service_type: {
              action: "created_or_updated",
              id: serviceResults.id,
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
