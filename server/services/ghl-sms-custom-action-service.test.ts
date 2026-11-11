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

describe("standard contact fields that GHL leaves out when empty", () => {
  const render = (template: string, contact: Record<string, unknown>) =>
    renderSmsMessage(template, {
      contact: { id: "c1", ...contact },
      locationId: "LOC_1",
      customValues: [],
    });

  it("uses 'there' for a missing first name instead of failing", () => {
    expect(render("Hi {{contact.first_name}}, paused.", { email: "a@b.com" })).toBe(
      "Hi there, paused."
    );
  });

  it("leaves a missing last name blank", () => {
    expect(render("[{{contact.last_name}}]", { firstName: "Jaylan" })).toBe("[]");
  });

  it("uses the stored first name when present", () => {
    expect(render("Hi {{contact.first_name}}", { firstName: "Jaylan" })).toBe("Hi Jaylan");
  });

  it("falls back to splitting the full name", () => {
    expect(
      render("{{contact.first_name}}|{{contact.last_name}}", { contactName: "Jaylan Beahan" })
    ).toBe("Jaylan|Beahan");
  });

  it("renders other empty standard fields as blank", () => {
    expect(render("[{{contact.city}}][{{contact.company_name}}]", {})).toBe("[][]");
  });

  it("still fails for a field that does not exist", () => {
    expect(() => render("{{contact.not_a_real_field}}", {})).toThrow(/not_a_real_field/);
  });
});
