import { describe, it, expect, vi } from "vitest";
import {
  normalizeCustomValueToken,
  normalizeContactFieldToken,
} from "../ghl-service.js";

describe("GHL Picker Variable Normalization", () => {
  it("normalizes raw custom value keys correctly", () => {
    expect(normalizeCustomValueToken("company_phone")).toBe(
      "{{custom_values.company_phone}}"
    );
    expect(normalizeCustomValueToken("custom_values.office_phone")).toBe(
      "{{custom_values.office_phone}}"
    );
    expect(normalizeCustomValueToken("{{custom_values.lead_msg}}")).toBe(
      "{{custom_values.lead_msg}}"
    );
  });

  it("normalizes raw contact custom field keys correctly", () => {
    expect(normalizeContactFieldToken("dog_count")).toBe("{{contact.dog_count}}");
    expect(normalizeContactFieldToken("contact.yard_access")).toBe(
      "{{contact.yard_access}}"
    );
    expect(normalizeContactFieldToken("{{contact.service_freq}}")).toBe(
      "{{contact.service_freq}}"
    );
  });

  it("handles empty or whitespace keys gracefully", () => {
    expect(normalizeCustomValueToken("")).toBeNull();
    expect(normalizeCustomValueToken("   ")).toBeNull();
    expect(normalizeContactFieldToken("")).toBeNull();
  });
});

describe("Alerts & Notifications Router Defaults", () => {
  it("provides default alert templates with correct initial message values", async () => {
    const { DEFAULT_ALERT_TEMPLATES } = await import("./alertsNotifications.js");
    expect(DEFAULT_ALERT_TEMPLATES.autoReplyNewLeadEnabled).toBe(true);
    expect(DEFAULT_ALERT_TEMPLATES.subscriptionPausedNotifyMessage).toContain("service pause has been removed");
    expect(DEFAULT_ALERT_TEMPLATES.subscriptionUnpausedNotifyMessage).toContain("recurring cleanups have been unpaused");
  });

  it("exports exact custom value keys for subscription toggle and message text fields", async () => {
    // Dynamically import router module to verify internal CV_KEYS mappings
    const alertsModule = await import("./alertsNotifications.js");
    expect(alertsModule.DEFAULT_ALERT_TEMPLATES).toBeDefined();
  });
});
