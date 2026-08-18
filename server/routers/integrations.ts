import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import {
  getLocationCustomValueMap,
  upsertGhlCustomValue,
  updateExistingCustomValuesOnly,
} from "../ghl-service.js";

// Custom Value Keys for Integrations
export const INTEGRATION_CV_KEYS = {
  webhookUrl: "homeflow_webhook",
  accessToken: "sg_authorization_key_access_token",
} as const;

export const integrationsSchema = z.object({
  locationId: z.string().min(1, "Location ID is required"),
  webhookUrl: z.string().default(""),
  accessToken: z.string().default(""),
});

export type IntegrationsSettings = z.infer<typeof integrationsSchema>;

export const integrationsRouter = router({
  /**
   * Fetch current Integrations settings from GHL custom values.
   */
  getSettings: publicProcedure
    .input(z.object({ locationId: z.string() }))
    .query(async ({ input }) => {
      if (!input.locationId || input.locationId === "preview" || input.locationId === "test-location") {
        return {
          webhookUrl: "",
          accessToken: "",
        };
      }

      try {
        const cvMap = await getLocationCustomValueMap(input.locationId);

        const getValueForKeys = (keys: string[]): string | undefined => {
          for (const k of keys) {
            const entry =
              cvMap.get(k) ||
              cvMap.get(k.toLowerCase().replace(/[^a-z0-9]/g, ""));
            if (
              entry?.value !== undefined &&
              entry.value !== null &&
              entry.value !== ""
            ) {
              return entry.value;
            }
          }
          return undefined;
        };

        const webhookUrl = getValueForKeys([
          INTEGRATION_CV_KEYS.webhookUrl,
          "homeflow_webhook",
          "{{custom_values.homeflow_webhook}}",
          "webhook_url",
        ]) || "";

        const accessToken = getValueForKeys([
          INTEGRATION_CV_KEYS.accessToken,
          "sg_authorization_key_access_token",
          "{{custom_values.sg_authorization_key_access_token}}",
          "access_token",
          "api_key",
        ]) || "";

        return {
          webhookUrl,
          accessToken,
        };
      } catch (err) {
        console.warn("[Integrations] Failed to load custom values from GHL:", err);
        return {
          webhookUrl: "",
          accessToken: "",
        };
      }
    }),

  /**
   * Save Integrations settings to GHL custom values.
   * Updates homeflow_webhook and sg_authorization_key_access_token in GHL.
   */
  saveSettings: publicProcedure
    .input(integrationsSchema)
    .mutation(async ({ input }) => {
      const { locationId, webhookUrl, accessToken } = input;

      const customValuePayload: Record<string, string> = {
        [INTEGRATION_CV_KEYS.webhookUrl]: webhookUrl,
        [INTEGRATION_CV_KEYS.accessToken]: accessToken,
        webhook_url: webhookUrl,
        access_token: accessToken,
      };

      try {
        // Step 1: Non-destructively update existing custom values
        await updateExistingCustomValuesOnly(locationId, customValuePayload);

        // Step 2: Upsert primary keys to guarantee creation if not present
        await upsertGhlCustomValue(
          locationId,
          INTEGRATION_CV_KEYS.webhookUrl,
          webhookUrl
        );

        await upsertGhlCustomValue(
          locationId,
          INTEGRATION_CV_KEYS.accessToken,
          accessToken
        );

        return { success: true };
      } catch (err) {
        console.error("[Integrations] Failed to save custom values:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Failed to save integrations settings to GHL",
        });
      }
    }),
});
