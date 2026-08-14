import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getLocationCustomValueMap,
  upsertGhlCustomValue,
} from "../ghl-service";

// ─── Add-On Duration options ─────────────────────────────────────────
// UI labels shown to the user
const ADDON_DURATION_LABELS = [
  "4 Weeks",
  "6 Weeks",
  "8 Weeks",
  "10 Weeks",
  "12 Weeks",
] as const;
type AddonDuration = (typeof ADDON_DURATION_LABELS)[number];

// The value that gets stored in GHL (matches the option tokens in GHL)
const ADDON_DURATION_TO_GHL_VALUE: Record<AddonDuration, string> = {
  "4 Weeks": "4_weeks",
  "6 Weeks": "6_weeks",
  "8 Weeks": "8_weeks",
  "10 Weeks": "10_weeks",
  "12 Weeks": "12_weeks",
};

// ─── Custom value names (GHL) ────────────────────────────────────────
// GHL display name used for WRITING (what GHL calls it)
const CV_WRITE_NAME =
  "Add-On Duration (options: 4_weeks, 6_weeks, 8_weeks, 10_weeks, 12_weeks)";
// GHL field key used for READING (the {{custom_values.addon_duration}} key)
const CV_READ_KEY = "addon_duration";

// ─── Normalize a duration label → index ──────────────────────────────
function addonDurationToIndex(value: string): number {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
  const map: Record<string, number> = {
    "4 weeks": 0,
    "4 wk": 0,
    "4w": 0,
    "6 weeks": 1,
    "6 wk": 1,
    "6w": 1,
    "8 weeks": 2,
    "8 wk": 2,
    "8w": 2,
    "10 weeks": 3,
    "10 wk": 3,
    "10w": 3,
    "12 weeks": 4,
    "12 wk": 4,
    "12w": 4,
  };

  // Also try matching against stored GHL values (4_weeks, 6_weeks, etc.)
  const ghlToIndex: Record<string, number> = {
    "4_weeks": 0,
    "6_weeks": 1,
    "8_weeks": 2,
    "10_weeks": 3,
    "12_weeks": 4,
  };

  const lower = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (ghlToIndex[lower] !== undefined) return ghlToIndex[lower];

  return (
    map[normalized] ??
    ADDON_DURATION_LABELS.findIndex(l => l.toLowerCase() === normalized) ??
    3 // default to 10 Weeks
  );
}

// ─── Router ───────────────────────────────────────────────────────────
export const addOnCampaignRouter = router({
  /**
   * Load current add-on campaign settings from GHL custom values.
   * Reads from {{custom_values.addon_duration}} key.
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
          if (
            norm === key.toLowerCase() ||
            apiKey.toLowerCase() === key.toLowerCase()
          ) {
            result = entry.value;
          }
        });
        return result;
      };

      const savedDuration = get(CV_READ_KEY);

      return {
        addonDuration: addonDurationToIndex(savedDuration),
      };
    }),

  /**
   * Save add-on campaign settings to GHL custom values.
   * Updates the existing "Add-On Duration" custom value (fieldKey: addon_duration).
   * Stores the GHL option token (e.g., "4_weeks", "10_weeks").
   */
  saveSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1, "Location ID is required"),
        addonDuration: z.enum(ADDON_DURATION_LABELS),
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

        // Use the GHL display name so findCustomValueId can match the existing field
        // The stored value is the option token (e.g., "10_weeks")
        const ghlValue = ADDON_DURATION_TO_GHL_VALUE[input.addonDuration];

        await upsertGhlCustomValue(locationId, CV_WRITE_NAME, ghlValue);

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("[addOnCampaign] saveSettings error:", msg);
        if (
          msg.includes("401") ||
          msg.includes("Unauthorized") ||
          msg.includes("token")
        ) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "GHL authentication failed. Your access token may be missing or expired.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            msg || "Failed to save add-on campaign settings. Please try again.",
        });
      }
    }),
});
