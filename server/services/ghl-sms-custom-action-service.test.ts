import { describe, expect, it } from "vitest";
import {
  renderSmsMessage,
  toE164Phone,
} from "./ghl-sms-custom-action-service.js";

const base = {
  locationId: "LOC_1",
  customValues: [] as Record<string, unknown>[],
};

describe("toE164Phone (#34)", () => {
  it.each([
    ["(555) 123-4567", "+15551234567"],
    ["555.123.4567", "+15551234567"],
    ["1-555-123-4567", "+15551234567"],
    ["+1 (555) 123-4567", "+15551234567"],
    ["+447700900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
  ])("%s -> %s", (input, expected) => {
    expect(toE164Phone(input)).toBe(expected);
  });
});

describe("renderSmsMessage contact custom fields (#35)", () => {
  const definitions = [
    {
      id: "FIELD_SKIP",
      fieldKey: "contact.skip_reason",
      displayName: "Skip Reason",
    },
  ];

  it("resolves {{contact.skip_reason}} from GHL's {id, value} custom fields", () => {
    const message = renderSmsMessage(
      "Hi {{contact.first_name}}, due to {{contact.skip_reason}} we skipped.",
      {
        ...base,
        contact: {
          firstName: "Ann",
          customFields: [{ id: "FIELD_SKIP", value: "bad weather" }],
        },
        contactFieldDefinitions: definitions,
      }
    );
    expect(message).toBe("Hi Ann, due to bad weather we skipped.");
  });

  it("renders a defined field with no value as empty instead of failing", () => {
    const message = renderSmsMessage("Reason: {{contact.skip_reason}}.", {
      ...base,
      contact: { firstName: "Ann", customFields: [] },
      contactFieldDefinitions: definitions,
    });
    expect(message).toBe("Reason: .");
  });

  it("still rejects merge fields that do not exist at all", () => {
    expect(() =>
      renderSmsMessage("{{contact.not_a_field}}", {
        ...base,
        contact: {},
        contactFieldDefinitions: definitions,
      })
    ).toThrow(/Unable to resolve SMS merge field/);
  });
});

describe("custom value lookup matches how values are saved (#37/#38)", () => {
  it("finds the paused message stored under its alternative GHL name", () => {
    const message = renderSmsMessage(
      "{{custom_values.custom_subscription_pausedunpaused_message}}",
      {
        ...base,
        contact: {},
        customValues: [
          {
            id: "CV_PAUSED",
            name: "Custom Subscription Paused Message",
            fieldKey: "{{ custom_values.custom_subscription_paused_message }}",
            value: "Your service is paused.",
          },
        ],
      }
    );
    expect(message).toBe("Your service is paused.");
  });
});
