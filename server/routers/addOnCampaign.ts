import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue } from "../ghl-service";

// ─── Add-On Duration options ─────────────────────────────────────────
// Mapped to: {{custom_values.addon_duration}}
const ADDON_DURATION_LABELS = [
  "4 Weeks",
  "6 Weeks",
  "8 Weeks",
  "10 Weeks",
  "12 Weeks",
] as const;
type AddonDuration = (typeof ADDON_DURATION_LABELS)[number];

// ─── Custom value key name (GHL) ─────────────────────────────────────
const CV = {
  addonDuration: "addon_duration",
} as const;

// ─── Normalize a duration label → index ──────────────────────────────
function addonDurationToIndex(value: string): number {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
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
  return (
    map[normalized] ??
    ADDON_DURATION_LABELS.findIndex((l) => l.toLowerCase() === normalized) ??
    3 // default to 10 Weeks
  );
}

// ─── Router ───────────────────────────────────────────────────────────
export const addOnCampaignRouter = router({
  /**
   * Load current add-on campaign settings from GHL custom values.
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

      const savedDuration = get(CV.addonDuration);

      return {
        addonDuration: addonDurationToIndex(savedDuration),
      };
    }),

  /**
   * Save add-on campaign settings to GHL custom values.
   * Writes addon_duration as one of: "4 Weeks" | "6 Weeks" | "8 Weeks" | "10 Weeks" | "12 Weeks"
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "Location ID cannot be empty" });
        }

        await upsertGhlCustomValue(
          locationId,
          CV.addonDuration,
          input.addonDuration
        );

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("[addOnCampaign] saveSettings error:", msg);
        if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("token")) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "GHL authentication failed. Your access token may be missing or expired.",
          });
        }
        // Let the actual GHL error message through so the client can show it
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msg || "Failed to save add-on campaign settings. Please try again.",
        });
      }
    }),
});
