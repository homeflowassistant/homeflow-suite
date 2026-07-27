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
        })
      )
      .mutation(async ({ input }) => {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
        }
        const [leadOptionResults, initialResults, followUpResults] = await Promise.all([
          upsertGhlCustomValue(locationId, "lead_follow_up_option", input.leadFollowUpOption),
          upsertGhlCustomValue(locationId, "initial_request_scheduling", input.initialRequestScheduling),
          upsertGhlCustomValue(locationId, FOLLOW_UP_CUSTOM_VALUE_NAME, input.followUpLimit),
        ]);

        return {
          success: true,
          saved: {
            lead_follow_up_option: leadOptionResults.value,
            initial_request_scheduling: initialResults.value,
            [FOLLOW_UP_CUSTOM_VALUE_NAME]: followUpResults.value,
          },
          results: {
            lead_follow_up_option: { action: "created_or_updated", id: leadOptionResults.id },
            initial_request_scheduling: { action: "created_or_updated", id: initialResults.id },
            [FOLLOW_UP_CUSTOM_VALUE_NAME]: { action: "created_or_updated", id: followUpResults.id },
          },
        };
      }),
  });