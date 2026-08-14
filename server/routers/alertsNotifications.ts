import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getLocationCustomValueMap,
  upsertGhlCustomValue,
  updateExistingCustomValuesOnly,
} from "../ghl-service.js";

// ─── Default Templates matching UI layout exact specifications ─────────
export const DEFAULT_ALERT_TEMPLATES = {
  autoReplyNewLeadEnabled: true,
  autoReplyNewLeadMessage:
    "Thanks for contacting {{location.name}}! We've received your request and will be in touch shortly. We look forward to helping you enjoy a cleaner, poop-free yard!",

  autoReplyNewCustomerEnabled: true,
  autoReplyNewCustomerMessage:
    "Thanks for signing up with {{location.name}}! We look forward to keeping your yard clean and enjoyable year-round.",

  teamNotifyNewLeadEnabled: true,
  teamNotifyNewLeadMessage:
    "New Lead Received:\nName: {{name}}\nPhone: {{phone}}\nEmail: {{email}}\nCity: {{address}}\nDogs: {{dogs}}\nFrequency: {{frequency}}\nGive them a call!",

  teamNotifyNewCustomerEnabled: true,
  teamNotifyNewCustomerMessage:
    "New Customer Sign Up!\nName:\nPhone:\nEmail:\nCity:\n\nPlease assign the customer to a route",

  teamNotifyPhone: "",
  teamNotifyEmail: "",

  failedPaymentNotifyEnabled: true,
  failedPaymentNotifyMessage:
    "Hi John, we were unable to process your recent payment. To avoid any interruption in service, please update your payment method using the secure link below:",

  skippedJobNotifyEnabled: true,
  skippedJobNotifyMessage:
    "Hi John, due to your gate being locked, we were unable to complete your scheduled service. We apologize for the inconvenience and will be back on your next service day. Thank you for your patience!",

  subscriptionPausedNotifyEnabled: true,
  subscriptionPausedNotifyMessage:
    "Hi John, your service pause has been removed, and your recurring cleanups will resume as scheduled, as requested. Thank you for trusting {{location.name}}!",
};

/**
 * GHL Custom Value Key Mappings matching the exact names & keys in the
 * "Alerts and Notifications" folder screenshot:
 *
 * 1. Auto-Reply New Customer Message      → {{custom_values.autoreply_new_customer_message}}
 * 2. Auto-Reply New Lead Message          → {{custom_values.autoreply_new_lead_message}}
 * 3. Custom Failed Payment Message        → {{custom_values.custom_failed_payment_message}}
 * 4. Custom Skipped Job Message           → {{custom_values.custom_skipped_job_message}}
 * 5. Custom Subscription Paused/Unpaused  → {{custom_values.custom_subscription_pausedunpaused_message}}
 * 6. Send Team Notification Email         → {{custom_values.send_team_notification_email}}
 * 7. Send Team Notification Phone         → {{custom_values.send_team_notification_phone}}
 * 8. Team-Notification New Customer Msg   → {{custom_values.teamnotification_new_customer_message}}
 * 9. Team-Notification New Lead Msg       → {{custom_values.teamnotification_new_lead_message}}
 */
const CV_KEYS = {
  // Primary Keys from GHL Folder
  autoReplyNewLeadMessage: "autoreply_new_lead_message",
  autoReplyNewCustomerMessage: "autoreply_new_customer_message",
  teamNotifyNewLeadMessage: "teamnotification_new_lead_message",
  teamNotifyNewCustomerMessage: "teamnotification_new_customer_message",
  teamNotifyPhone: "send_team_notification_phone",
  teamNotifyEmail: "send_team_notification_email",
  failedPaymentNotifyMessage: "custom_failed_payment_message",
  skippedJobNotifyMessage: "custom_skipped_job_message",
  subscriptionPausedNotifyMessage: "custom_subscription_pausedunpaused_message",

  // Toggle State Keys
  autoReplyNewLeadEnabled: "autoreply_new_lead_enabled",
  autoReplyNewCustomerEnabled: "autoreply_new_customer_enabled",
  teamNotifyNewLeadEnabled: "teamnotification_new_lead_enabled",
  teamNotifyNewCustomerEnabled: "teamnotification_new_customer_enabled",
  failedPaymentNotifyEnabled: "custom_failed_payment_enabled",
  skippedJobNotifyEnabled: "custom_skipped_job_enabled",
  subscriptionPausedNotifyEnabled: "custom_subscription_pausedunpaused_enabled",
} as const;

export const alertsNotificationsSchema = z.object({
  locationId: z.string().min(1, "Location ID is required"),
  autoReplyNewLeadEnabled: z.boolean(),
  autoReplyNewLeadMessage: z.string(),
  autoReplyNewCustomerEnabled: z.boolean(),
  autoReplyNewCustomerMessage: z.string(),
  teamNotifyNewLeadEnabled: z.boolean(),
  teamNotifyNewLeadMessage: z.string(),
  teamNotifyNewCustomerEnabled: z.boolean(),
  teamNotifyNewCustomerMessage: z.string(),
  teamNotifyPhone: z.string(),
  teamNotifyEmail: z.string(),
  failedPaymentNotifyEnabled: z.boolean(),
  failedPaymentNotifyMessage: z.string(),
  skippedJobNotifyEnabled: z.boolean(),
  skippedJobNotifyMessage: z.string(),
  subscriptionPausedNotifyEnabled: z.boolean(),
  subscriptionPausedNotifyMessage: z.string(),
});

export type AlertsNotificationsSettings = z.infer<
  typeof alertsNotificationsSchema
>;

export const alertsNotificationsRouter = router({
  /**
   * Fetch current alert settings from GHL custom values.
   * Performs flexible key matching supporting exact GHL folder keys as well as fallback aliases.
   */
  getSettings: publicProcedure
    .input(z.object({ locationId: z.string() }))
    .query(async ({ input }) => {
      if (!input.locationId) {
        return DEFAULT_ALERT_TEMPLATES;
      }

      try {
        const cvMap = await getLocationCustomValueMap(input.locationId);

        // Normalize helper to search across key variants
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

        const parseBool = (keys: string[], fallback: boolean): boolean => {
          const val = getValueForKeys(keys);
          if (!val) return fallback;
          return (
            val.trim().toUpperCase() === "ON" ||
            val.trim().toLowerCase() === "true"
          );
        };

        const parseStr = (keys: string[], fallback: string): string => {
          const val = getValueForKeys(keys);
          return val !== undefined ? val : fallback;
        };

        return {
          autoReplyNewLeadEnabled: parseBool(
            [CV_KEYS.autoReplyNewLeadEnabled, "auto_reply_new_lead_enabled"],
            DEFAULT_ALERT_TEMPLATES.autoReplyNewLeadEnabled
          ),
          autoReplyNewLeadMessage: parseStr(
            [
              CV_KEYS.autoReplyNewLeadMessage,
              "auto_reply_new_lead_message",
              "Auto-Reply New Lead Message",
            ],
            DEFAULT_ALERT_TEMPLATES.autoReplyNewLeadMessage
          ),

          autoReplyNewCustomerEnabled: parseBool(
            [
              CV_KEYS.autoReplyNewCustomerEnabled,
              "auto_reply_new_customer_enabled",
            ],
            DEFAULT_ALERT_TEMPLATES.autoReplyNewCustomerEnabled
          ),
          autoReplyNewCustomerMessage: parseStr(
            [
              CV_KEYS.autoReplyNewCustomerMessage,
              "auto_reply_new_customer_message",
              "Auto-Reply New Customer Message",
            ],
            DEFAULT_ALERT_TEMPLATES.autoReplyNewCustomerMessage
          ),

          teamNotifyNewLeadEnabled: parseBool(
            [CV_KEYS.teamNotifyNewLeadEnabled, "team_notify_new_lead_enabled"],
            DEFAULT_ALERT_TEMPLATES.teamNotifyNewLeadEnabled
          ),
          teamNotifyNewLeadMessage: parseStr(
            [
              CV_KEYS.teamNotifyNewLeadMessage,
              "team_notify_new_lead_message",
              "Team-Notification New Lead Message",
            ],
            DEFAULT_ALERT_TEMPLATES.teamNotifyNewLeadMessage
          ),

          teamNotifyNewCustomerEnabled: parseBool(
            [
              CV_KEYS.teamNotifyNewCustomerEnabled,
              "team_notify_new_customer_enabled",
            ],
            DEFAULT_ALERT_TEMPLATES.teamNotifyNewCustomerEnabled
          ),
          teamNotifyNewCustomerMessage: parseStr(
            [
              CV_KEYS.teamNotifyNewCustomerMessage,
              "team_notify_new_customer_message",
              "Team-Notification New Customer Message",
            ],
            DEFAULT_ALERT_TEMPLATES.teamNotifyNewCustomerMessage
          ),

          teamNotifyPhone: parseStr(
            [
              CV_KEYS.teamNotifyPhone,
              "team_notify_phone",
              "Send Team Notification Phone",
            ],
            DEFAULT_ALERT_TEMPLATES.teamNotifyPhone
          ),
          teamNotifyEmail: parseStr(
            [
              CV_KEYS.teamNotifyEmail,
              "team_notify_email",
              "Send Team Notification Email",
            ],
            DEFAULT_ALERT_TEMPLATES.teamNotifyEmail
          ),

          failedPaymentNotifyEnabled: parseBool(
            [
              CV_KEYS.failedPaymentNotifyEnabled,
              "failed_payment_notify_enabled",
            ],
            DEFAULT_ALERT_TEMPLATES.failedPaymentNotifyEnabled
          ),
          failedPaymentNotifyMessage: parseStr(
            [
              CV_KEYS.failedPaymentNotifyMessage,
              "failed_payment_notify_message",
              "Custom Failed Payment Message",
            ],
            DEFAULT_ALERT_TEMPLATES.failedPaymentNotifyMessage
          ),

          skippedJobNotifyEnabled: parseBool(
            [CV_KEYS.skippedJobNotifyEnabled, "skipped_job_notify_enabled"],
            DEFAULT_ALERT_TEMPLATES.skippedJobNotifyEnabled
          ),
          skippedJobNotifyMessage: parseStr(
            [
              CV_KEYS.skippedJobNotifyMessage,
              "skipped_job_notify_message",
              "Custom Skipped Job Message",
            ],
            DEFAULT_ALERT_TEMPLATES.skippedJobNotifyMessage
          ),

          subscriptionPausedNotifyEnabled: parseBool(
            [
              CV_KEYS.subscriptionPausedNotifyEnabled,
              "subscription_paused_notify_enabled",
            ],
            DEFAULT_ALERT_TEMPLATES.subscriptionPausedNotifyEnabled
          ),
          subscriptionPausedNotifyMessage: parseStr(
            [
              CV_KEYS.subscriptionPausedNotifyMessage,
              "subscription_paused_notify_message",
              "Custom Subscription Paused/Unpaused Message",
            ],
            DEFAULT_ALERT_TEMPLATES.subscriptionPausedNotifyMessage
          ),
        };
      } catch (err) {
        console.warn(
          "[AlertsNotifications] Failed to load custom values from GHL, using defaults:",
          err
        );
        return DEFAULT_ALERT_TEMPLATES;
      }
    }),

  /**
   * Save alert settings to GHL custom values.
   * Maps typed form values to the exact custom value keys in the GHL "Alerts and Notifications" folder.
   * Uses non-destructive update strategy preserving GHL display names.
   */
  saveSettings: publicProcedure
    .input(alertsNotificationsSchema)
    .mutation(async ({ input }) => {
      const { locationId, ...data } = input;

      // Exact GHL Custom Value Key Mappings matching screenshot
      const customValuePayload: Record<string, string> = {
        // Message Templates
        [CV_KEYS.autoReplyNewLeadMessage]: data.autoReplyNewLeadMessage,
        [CV_KEYS.autoReplyNewCustomerMessage]: data.autoReplyNewCustomerMessage,
        [CV_KEYS.teamNotifyNewLeadMessage]: data.teamNotifyNewLeadMessage,
        [CV_KEYS.teamNotifyNewCustomerMessage]:
          data.teamNotifyNewCustomerMessage,
        [CV_KEYS.teamNotifyPhone]: data.teamNotifyPhone,
        [CV_KEYS.teamNotifyEmail]: data.teamNotifyEmail,
        [CV_KEYS.failedPaymentNotifyMessage]: data.failedPaymentNotifyMessage,
        [CV_KEYS.skippedJobNotifyMessage]: data.skippedJobNotifyMessage,
        [CV_KEYS.subscriptionPausedNotifyMessage]:
          data.subscriptionPausedNotifyMessage,

        // Also dual-write secondary aliases for complete sub-account coverage
        auto_reply_new_lead_message: data.autoReplyNewLeadMessage,
        auto_reply_new_customer_message: data.autoReplyNewCustomerMessage,
        team_notify_new_lead_message: data.teamNotifyNewLeadMessage,
        team_notify_new_customer_message: data.autoReplyNewCustomerMessage,
        team_notify_phone: data.teamNotifyPhone,
        team_notify_email: data.teamNotifyEmail,
        failed_payment_notify_message: data.failedPaymentNotifyMessage,
        skipped_job_notify_message: data.skippedJobNotifyMessage,
        subscription_paused_notify_message:
          data.subscriptionPausedNotifyMessage,

        // Toggle States
        [CV_KEYS.autoReplyNewLeadEnabled]: data.autoReplyNewLeadEnabled
          ? "ON"
          : "OFF",
        [CV_KEYS.autoReplyNewCustomerEnabled]: data.autoReplyNewCustomerEnabled
          ? "ON"
          : "OFF",
        [CV_KEYS.teamNotifyNewLeadEnabled]: data.teamNotifyNewLeadEnabled
          ? "ON"
          : "OFF",
        [CV_KEYS.teamNotifyNewCustomerEnabled]:
          data.teamNotifyNewCustomerEnabled ? "ON" : "OFF",
        [CV_KEYS.failedPaymentNotifyEnabled]: data.failedPaymentNotifyEnabled
          ? "ON"
          : "OFF",
        [CV_KEYS.skippedJobNotifyEnabled]: data.skippedJobNotifyEnabled
          ? "ON"
          : "OFF",
        [CV_KEYS.subscriptionPausedNotifyEnabled]:
          data.subscriptionPausedNotifyEnabled ? "ON" : "OFF",
      };

      try {
        // Step 1: Update existing custom values while preserving display names
        await updateExistingCustomValuesOnly(locationId, customValuePayload);

        // Step 2: Upsert primary keys to guarantee creation if not existing
        const primaryEntries = [
          [CV_KEYS.autoReplyNewLeadMessage, data.autoReplyNewLeadMessage],
          [
            CV_KEYS.autoReplyNewCustomerMessage,
            data.autoReplyNewCustomerMessage,
          ],
          [CV_KEYS.teamNotifyNewLeadMessage, data.teamNotifyNewLeadMessage],
          [
            CV_KEYS.teamNotifyNewCustomerMessage,
            data.teamNotifyNewCustomerMessage,
          ],
          [CV_KEYS.teamNotifyPhone, data.teamNotifyPhone],
          [CV_KEYS.teamNotifyEmail, data.teamNotifyEmail],
          [CV_KEYS.failedPaymentNotifyMessage, data.failedPaymentNotifyMessage],
          [CV_KEYS.skippedJobNotifyMessage, data.skippedJobNotifyMessage],
          [
            CV_KEYS.subscriptionPausedNotifyMessage,
            data.subscriptionPausedNotifyMessage,
          ],
        ];

        for (const [key, val] of primaryEntries) {
          try {
            await upsertGhlCustomValue(locationId, key, val);
          } catch (e) {
            console.warn(
              `[AlertsNotifications] Upsert custom value '${key}':`,
              e
            );
          }
        }

        return { success: true };
      } catch (err) {
        console.error("[AlertsNotifications] Error saving settings:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            err instanceof Error
              ? err.message
              : "Failed to save alert notification settings",
        });
      }
    }),
});
