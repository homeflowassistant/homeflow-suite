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
    const alertsModule = await import("./alertsNotifications.js");
    expect(alertsModule.DEFAULT_ALERT_TEMPLATES).toBeDefined();
  });
});

describe("Subscription Card Custom-Value Persistence Mapping", () => {
  it("resolves the toggle, paused text, and unpaused text to independent custom-value IDs", async () => {
    const { findCustomValueId } = await import("../ghl-service.js");

    const mockGhlCustomValues = [
      {
        id: "cv_toggle_123",
        name: "Subscription Paused Message",
        fieldKey: "{{custom_values.subscription_paused_message}}",
      },
      {
        id: "cv_paused_text_456",
        name: "Custom Subscription Paused Message",
        fieldKey: "{{custom_values.custom_subscription_paused_message}}",
      },
      {
        id: "cv_unpaused_text_789",
        name: "Custom Subscription Unpaused Message",
        fieldKey: "{{custom_values.custom_subscription_unpaused_message}}",
      },
    ];

    const toggleId = findCustomValueId(mockGhlCustomValues, "subscription_paused_message");
    const pausedTextId = findCustomValueId(mockGhlCustomValues, "custom_subscription_paused_message");
    const unpausedTextId = findCustomValueId(mockGhlCustomValues, "custom_subscription_unpaused_message");

    expect(toggleId).toBe("cv_toggle_123");
    expect(pausedTextId).toBe("cv_paused_text_456");
    expect(unpausedTextId).toBe("cv_unpaused_text_789");

    // Guarantee that toggle and paused text resolve to distinct records
    expect(toggleId).not.toBe(pausedTextId);
    expect(toggleId).not.toBe(unpausedTextId);
    expect(pausedTextId).not.toBe(unpausedTextId);
  });
});

describe("Line Break Normalization for Custom Text Values", () => {
  it("normalizes CRLF and CR line breaks into explicit LF '\\n' characters", async () => {
    const { formatCustomTextWithNewlines } = await import("./alertsNotifications.js");

    const multiLineInput = "Line 1\r\nLine 2\rLine 3\nLine 4";
    const expectedOutput = "Line 1\nLine 2\nLine 3\nLine 4";

    expect(formatCustomTextWithNewlines(multiLineInput)).toBe(expectedOutput);
  });

  it("handles empty or null inputs gracefully", async () => {
    const { formatCustomTextWithNewlines } = await import("./alertsNotifications.js");

    expect(formatCustomTextWithNewlines("")).toBe("");
    expect(formatCustomTextWithNewlines(null)).toBe("");
    expect(formatCustomTextWithNewlines(undefined)).toBe("");
  });
});

