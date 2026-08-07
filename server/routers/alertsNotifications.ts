import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationCustomValueMap, upsertGhlCustomValue, updateExistingCustomValuesOnly } from "../ghl-service.js";

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

// GHL Custom Value Keys
const CV_KEYS = {
  autoReplyNewLeadEnabled: "auto_reply_new_lead_enabled",
  autoReplyNewLeadMessage: "auto_reply_new_lead_message",
  autoReplyNewCustomerEnabled: "auto_reply_new_customer_enabled",
  autoReplyNewCustomerMessage: "auto_reply_new_customer_message",
  teamNotifyNewLeadEnabled: "team_notify_new_lead_enabled",
  teamNotifyNewLeadMessage: "team_notify_new_lead_message",
  teamNotifyNewCustomerEnabled: "team_notify_new_customer_enabled",
  teamNotifyNewCustomerMessage: "team_notify_new_customer_message",
  teamNotifyPhone: "team_notify_phone",
  teamNotifyEmail: "team_notify_email",
  failedPaymentNotifyEnabled: "failed_payment_notify_enabled",
  failedPaymentNotifyMessage: "failed_payment_notify_message",
  skippedJobNotifyEnabled: "skipped_job_notify_enabled",
  skippedJobNotifyMessage: "skipped_job_notify_message",
  subscriptionPausedNotifyEnabled: "subscription_paused_notify_enabled",
  subscriptionPausedNotifyMessage: "subscription_paused_notify_message",
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

export type AlertsNotificationsSettings = z.infer<typeof alertsNotificationsSchema>;

export const alertsNotificationsRouter = router({
  getSettings: publicProcedure
    .input(z.object({ locationId: z.string() }))
    .query(async ({ input }) => {
      if (!input.locationId) {
        return DEFAULT_ALERT_TEMPLATES;
      }

      try {
        const cvMap = await getLocationCustomValueMap(input.locationId);

        const parseBool = (key: string, fallback: boolean): boolean => {
          const entry = cvMap.get(key) || cvMap.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
          const val = entry?.value;
          if (!val) return fallback;
          return val.trim().toUpperCase() === "ON" || val.trim().toLowerCase() === "true";
        };

        const parseStr = (key: string, fallback: string): string => {
          const entry = cvMap.get(key) || cvMap.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
          const val = entry?.value;
          return val !== undefined && val !== null && val !== "" ? val : fallback;
        };

        return {
          autoReplyNewLeadEnabled: parseBool(CV_KEYS.autoReplyNewLeadEnabled, DEFAULT_ALERT_TEMPLATES.autoReplyNewLeadEnabled),
          autoReplyNewLeadMessage: parseStr(CV_KEYS.autoReplyNewLeadMessage, DEFAULT_ALERT_TEMPLATES.autoReplyNewLeadMessage),

          autoReplyNewCustomerEnabled: parseBool(CV_KEYS.autoReplyNewCustomerEnabled, DEFAULT_ALERT_TEMPLATES.autoReplyNewCustomerEnabled),
          autoReplyNewCustomerMessage: parseStr(CV_KEYS.autoReplyNewCustomerMessage, DEFAULT_ALERT_TEMPLATES.autoReplyNewCustomerMessage),

          teamNotifyNewLeadEnabled: parseBool(CV_KEYS.teamNotifyNewLeadEnabled, DEFAULT_ALERT_TEMPLATES.teamNotifyNewLeadEnabled),
          teamNotifyNewLeadMessage: parseStr(CV_KEYS.teamNotifyNewLeadMessage, DEFAULT_ALERT_TEMPLATES.teamNotifyNewLeadMessage),

          teamNotifyNewCustomerEnabled: parseBool(CV_KEYS.teamNotifyNewCustomerEnabled, DEFAULT_ALERT_TEMPLATES.teamNotifyNewCustomerEnabled),
          teamNotifyNewCustomerMessage: parseStr(CV_KEYS.teamNotifyNewCustomerMessage, DEFAULT_ALERT_TEMPLATES.teamNotifyNewCustomerMessage),

          teamNotifyPhone: parseStr(CV_KEYS.teamNotifyPhone, DEFAULT_ALERT_TEMPLATES.teamNotifyPhone),
          teamNotifyEmail: parseStr(CV_KEYS.teamNotifyEmail, DEFAULT_ALERT_TEMPLATES.teamNotifyEmail),

          failedPaymentNotifyEnabled: parseBool(CV_KEYS.failedPaymentNotifyEnabled, DEFAULT_ALERT_TEMPLATES.failedPaymentNotifyEnabled),
          failedPaymentNotifyMessage: parseStr(CV_KEYS.failedPaymentNotifyMessage, DEFAULT_ALERT_TEMPLATES.failedPaymentNotifyMessage),

          skippedJobNotifyEnabled: parseBool(CV_KEYS.skippedJobNotifyEnabled, DEFAULT_ALERT_TEMPLATES.skippedJobNotifyEnabled),
          skippedJobNotifyMessage: parseStr(CV_KEYS.skippedJobNotifyMessage, DEFAULT_ALERT_TEMPLATES.skippedJobNotifyMessage),

          subscriptionPausedNotifyEnabled: parseBool(
            CV_KEYS.subscriptionPausedNotifyEnabled,
            DEFAULT_ALERT_TEMPLATES.subscriptionPausedNotifyEnabled
          ),
          subscriptionPausedNotifyMessage: parseStr(
            CV_KEYS.subscriptionPausedNotifyMessage,
            DEFAULT_ALERT_TEMPLATES.subscriptionPausedNotifyMessage
          ),
        };
      } catch (err) {
        console.warn("[AlertsNotifications] Failed to load custom values from GHL, using defaults:", err);
        return DEFAULT_ALERT_TEMPLATES;
      }
    }),

  saveSettings: publicProcedure.input(alertsNotificationsSchema).mutation(async ({ input }) => {
    const { locationId, ...data } = input;

    const customValuePayload: Record<string, string> = {
      [CV_KEYS.autoReplyNewLeadEnabled]: data.autoReplyNewLeadEnabled ? "ON" : "OFF",
      [CV_KEYS.autoReplyNewLeadMessage]: data.autoReplyNewLeadMessage,
      [CV_KEYS.autoReplyNewCustomerEnabled]: data.autoReplyNewCustomerEnabled ? "ON" : "OFF",
      [CV_KEYS.autoReplyNewCustomerMessage]: data.autoReplyNewCustomerMessage,

      [CV_KEYS.teamNotifyNewLeadEnabled]: data.teamNotifyNewLeadEnabled ? "ON" : "OFF",
      [CV_KEYS.teamNotifyNewLeadMessage]: data.teamNotifyNewLeadMessage,
      [CV_KEYS.teamNotifyNewCustomerEnabled]: data.teamNotifyNewCustomerEnabled ? "ON" : "OFF",
      [CV_KEYS.teamNotifyNewCustomerMessage]: data.teamNotifyNewCustomerMessage,
      [CV_KEYS.teamNotifyPhone]: data.teamNotifyPhone,
      [CV_KEYS.teamNotifyEmail]: data.teamNotifyEmail,

      [CV_KEYS.failedPaymentNotifyEnabled]: data.failedPaymentNotifyEnabled ? "ON" : "OFF",
      [CV_KEYS.failedPaymentNotifyMessage]: data.failedPaymentNotifyMessage,

      [CV_KEYS.skippedJobNotifyEnabled]: data.skippedJobNotifyEnabled ? "ON" : "OFF",
      [CV_KEYS.skippedJobNotifyMessage]: data.skippedJobNotifyMessage,

      [CV_KEYS.subscriptionPausedNotifyEnabled]: data.subscriptionPausedNotifyEnabled ? "ON" : "OFF",
      [CV_KEYS.subscriptionPausedNotifyMessage]: data.subscriptionPausedNotifyMessage,
    };

    try {
      await updateExistingCustomValuesOnly(locationId, customValuePayload);
      for (const [key, val] of Object.entries(customValuePayload)) {
        try {
          await upsertGhlCustomValue(locationId, key, val);
        } catch (e) {
          console.warn(`[AlertsNotifications] Upsert custom value '${key}':`, e);
        }
      }
      return { success: true };
    } catch (err) {
      console.error("[AlertsNotifications] Error saving settings:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Failed to save alert notification settings",
      });
    }
  }),
});
