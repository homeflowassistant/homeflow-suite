import { describe, it, expect, vi } from "vitest";
import {
  normalizeCustomValueToken,
  normalizeContactFieldToken,
} from "../ghl-service";

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
