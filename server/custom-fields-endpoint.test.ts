import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLocationCustomFields } from "./ghl-service.js";
import { renderSmsMessage } from "./services/ghl-sms-custom-action-service.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLocationCustomFields", () => {
  it("calls GHL's camelCase customFields endpoint for contact fields", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          customFields: [
            { id: "fld_skip", fieldKey: "contact.skip_reason", name: "Skip Reason" },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const fields = await fetchLocationCustomFields("LOC_1", "token");

    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/locations/LOC_1/customFields?model=contact");
    expect(url).not.toContain("custom-fields");
    expect(fields).toEqual([
      { id: "fld_skip", fieldKey: "contact.skip_reason", displayName: "Skip Reason" },
    ]);
  });

  it("renders {{contact.skip_reason}} once definitions load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            customFields: [{ id: "fld_skip", fieldKey: "contact.skip_reason", name: "Skip Reason" }],
          }),
          { status: 200 }
        )
      )
    );
    const definitions = await fetchLocationCustomFields("LOC_1", "token");
    const message = renderSmsMessage("Skipped: {{contact.skip_reason}}", {
      contact: {
        id: "c1",
        customFields: [{ id: "fld_skip", value: "Gate was locked" }],
      },
      locationId: "LOC_1",
      customValues: [],
      contactFieldDefinitions: definitions,
    });
    expect(message).toBe("Skipped: Gate was locked");
  });
});
