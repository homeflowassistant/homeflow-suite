import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the GHL service before importing the router
vi.mock("../ghl-service", () => ({
  getLocationCustomValueMap: vi.fn(),
  updateExistingCustomValuesOnly: vi.fn(),
}));

import {
  getLocationCustomValueMap,
  updateExistingCustomValuesOnly,
} from "../ghl-service.js";
import { appRouter } from "../routers.js";
import type { AppRouter } from "../routers.js";

const mockedGetMap = vi.mocked(getLocationCustomValueMap);
const mockedUpdate = vi.mocked(updateExistingCustomValuesOnly);

function createCaller() {
  return appRouter.createCaller({
    user: null,
    req: {} as never,
    res: {} as never,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Empty map simulates a location with no pricing custom values yet.
mockedGetMap.mockResolvedValue(new Map());
mockedUpdate.mockResolvedValue({ missingKeys: [], failedKeys: [] });

describe("pricing.getSettings", () => {
  it("returns seeded defaults when no GHL values exist", async () => {
    mockedGetMap.mockResolvedValue(new Map());
    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    expect(settings.initialPricing.length).toBe(6);
    expect(settings.oneTimePricing.length).toBe(6);
    expect(settings.initialPricing[0].value).toContain(
      "### One week OR less: $XX (1 dog)"
    );
    expect(settings.oneTimePricing[0].value).toContain(
      "## One-Time Quote Rate for 1 dog: $XX-XX per service"
    );
    expect(settings.regularZipCodes).toBe("");
    expect(settings.regularRecurringPricing[0].dogCount).toBe(1);
    // Premium ZIP codes start empty, while the editable rate template remains available.
    expect(settings.premiumZipCodes).toBe("");
    expect(settings.premiumRecurringPricing[0].text).toBe("");
  });

  it("reads existing FAQ prose from GHL keys", async () => {
    const map = new Map<string, { id: string; value: string }>();
    map.set("faq_one_time_quotes", {
      id: "cv1",
      value: "Initial service starts at $80.",
    });
    map.set("faq_price_list", {
      id: "cv2",
      value: "Initial service starts at $40.",
    });
    map.set("regular_pricing_zip_codes", { id: "cv3", value: "97501, 97502" });
    mockedGetMap.mockResolvedValue(map);

    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    expect(settings.oneTimePricing[0].value).toBe(
      "Initial service starts at $80."
    );
    expect(settings.initialPricing[0].value).toBe(
      "Initial service starts at $40."
    );
    expect(settings.regularZipCodes).toBe("97501, 97502");
  });

  it("falls back on normalized key variants", async () => {
    const map = new Map<string, { id: string; value: string }>();
    map.set("faq_one_time_quotes", { id: "cv1", value: "quoted from old key" });
    mockedGetMap.mockResolvedValue(map);

    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });
    expect(settings.oneTimePricing[0].value).toBe("quoted from old key");
  });

  it("returns defaults on GHL error without throwing", async () => {
    mockedGetMap.mockRejectedValue(new Error("GHL request failed: 401"));
    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });
    expect(settings.initialPricing[0].value).toContain("$XX");
  });

  it("prefills recurring defaults with the client's line wording", async () => {
    mockedGetMap.mockResolvedValue(new Map());
    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    const r3 = settings.regularRecurringPricing.find(x => x.dogCount === 3)!;
    expect(r3.text).toContain(
      "### 2x weekly Recurring Quote Rate for 3 dogs: $XX.XX per service"
    );
    expect(r3.text).toContain(
      "### Weekly Recurring Quote Rate for 3 dogs: $XX.XX per service"
    );
    expect(r3.text).toContain(
      "### Biweekly Recurring Quote Rate for 3 dogs: $XX.XX per service"
    );
    expect(r3.text).toContain(
      "### Monthly Recurring Quote Rate for 3 dogs: $XX.XX per service"
    );
  });

  it("loads canonical Markdown into the matching dog fields", async () => {
    mockedGetMap.mockResolvedValue(
      new Map([
        [
          "initial_and_recurring_pricing",
          {
            id: "cv-initial",
            value: [
              "# Initial Service Pricing for 1 Dog",
              "### One week OR less: $60 (1 dog)",
              "# Initial Service Pricing for 6+ Dogs",
              "### One week OR less: $70+ (6+ dogs)",
              "# Rule: Regular Recurring Pricing Applies to these zip codes:",
              "[97501, 97502]",
              "# Fixed Quotes for Recurring Services:",
              "## Recurring Service Prices for 1 Dog",
              "### Weekly Recurring Quote Rate for 1 dog: $25.00 per service",
              "## Recurring Service Prices for 6+ Dogs",
              "### Weekly Recurring Quote Rate for 6+ dogs: $XX.XX per service",
              "# Rule: Premium Recurring Pricing Applies to these zip codes:",
              "[]",
              "## Recurring Service Premium Prices for 1 Dog",
              "## Recurring Service Premium Prices for 6+ Dogs",
            ].join("\\n"),
          },
        ],
        [
          "onetime_pricing",
          {
            id: "cv-onetime",
            value: [
              "# One-Time Service Pricing For 1 DOG:",
              "## One-Time Quote Rate for 1 dog: $110-140 per service",
              "# One-Time Service Pricing For 6+ DOGS:",
              "## One-Time Quote Rate for 6+ dogs: $185+ per service",
            ].join("\\n"),
          },
        ],
        ["add_on_pricing", { id: "cv-addons", value: "Add-on name: $25" }],
      ])
    );

    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    expect(settings.initialPricing[0].value).toBe(
      "### One week OR less: $60 (1 dog)"
    );
    expect(settings.initialPricing[5].value).toBe(
      "### One week OR less: $70+ (6+ dogs)"
    );
    expect(settings.regularZipCodes).toBe("97501, 97502");
    expect(settings.regularRecurringPricing[0].text).toBe(
      "### Weekly Recurring Quote Rate for 1 dog: $25.00 per service"
    );
    expect(settings.regularRecurringPricing[5].text).toBe(
      "### Weekly Recurring Quote Rate for 6+ dogs: $XX.XX per service"
    );
    expect(settings.premiumRecurringPricing[0].text).toBe("");
    expect(settings.oneTimePricing[0].value).toBe(
      "## One-Time Quote Rate for 1 dog: $110-140 per service"
    );
    expect(settings.oneTimePricing[5].value).toBe(
      "## One-Time Quote Rate for 6+ dogs: $185+ per service"
    );
    expect(settings.crossSells).toBe("Add-on name: $25");
  });

  it("converts legacy GHL values into the client's free-text line format", async () => {
    // Legacy values written by the first version of this page:
    // "<Dog> Dogs\n2x Weekly: $18.69 per service\nMonthly: $70"
    const map = new Map<string, { id: string; value: string }>();
    map.set("regular_recurring_pricing", {
      id: "cv1",
      value: [
        "1 Dog",
        "2x Weekly: $18.69 per service",
        "Weekly: $21 per service",
        "Biweekly: $21 per service",
        "Monthly: $70",
        "",
        "2 Dogs",
        "2x Weekly: $18.69 per service",
        "Weekly: $21 per service",
        "Monthly: $75",
      ].join("\n"),
    });
    mockedGetMap.mockResolvedValue(map);

    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    const r1 = settings.regularRecurringPricing.find(x => x.dogCount === 1)!;
    expect(r1.text).toContain(
      "### 2x weekly Recurring Quote Rate for 1 dog: $18.69 per service"
    );
    expect(r1.text).toContain(
      "### Monthly Recurring Quote Rate for 1 dog: $70"
    );
    // 1 Dog's block must not leak the 2 Dogs rates
    expect(r1.text).not.toContain("2 dogs");
    const r2 = settings.regularRecurringPricing.find(x => x.dogCount === 2)!;
    expect(r2.text).toContain(
      "### Monthly Recurring Quote Rate for 2 dogs: $75"
    );
    expect(r2.text).toContain(
      "### 2x weekly Recurring Quote Rate for 2 dogs: $18.69 per service"
    );
  });

  it("preserves extra frequency lines in existing GHL values", async () => {
    const map = new Map<string, { id: string; value: string }>();
    map.set("regular_recurring_pricing", {
      id: "cv1",
      value:
        "2x weekly Recurring Quote Rate for 1 dog: $18.69 per service\nWeekly Recurring Quote Rate for 1 dog: $21 per service\n3x weekly Recurring Quote Rate for 1 dog: $25 per service\nMonthly Recurring Quote Rate for 1 dog: $70",
    });
    mockedGetMap.mockResolvedValue(map);

    const caller = createCaller();
    const settings = await caller.pricing.getSettings({ locationId: "loc123" });

    const r1 = settings.regularRecurringPricing.find(x => x.dogCount === 1)!;
    expect(r1.text).toContain(
      "### 3x weekly Recurring Quote Rate for 1 dog: $25 per service"
    );
    expect(r1.text.split("\n").length).toBe(4);
  });
});

describe("pricing.saveSettings", () => {
  const recurringEntry = (dogCount: number, lines: string) => ({
    dogCount,
    text: lines,
  });

  const validInput = (
    overrides: Partial<
      Parameters<AppRouter["pricing"]["saveSettings"]>["_def"]["_input_in"]
    > = {}
  ) => ({
    locationId: "loc123",
    initialPricing: [1, 2, 3, 4, 5, 6].map(d => ({
      dogLabel: `${d} Dog${d > 1 ? "s" : ""}`,
      value: "Initial service starts at $35 and covers the first two bags.",
    })),
    oneTimePricing: [1, 2, 3, 4, 5, 6].map(d => ({
      dogLabel: `${d} Dog${d > 1 ? "s" : ""}`,
      value: "Initial service starts at $75.",
    })),
    regularZipCodes: "97501, 97502, 97503",
    regularRecurringPricing: [1, 2, 3, 4, 5, 6].map(d =>
      recurringEntry(
        d,
        [
          `### 2x weekly Recurring Quote Rate for ${d} dog${d > 1 ? "s" : ""}: $18.69 per service`,
          `### Weekly Recurring Quote Rate for ${d} dog${d > 1 ? "s" : ""}: $21.00 per service`,
          `### Biweekly Recurring Quote Rate for ${d} dog${d > 1 ? "s" : ""}: $21.00 per service`,
          `### Monthly Recurring Quote Rate for ${d} dog${d > 1 ? "s" : ""}: $70`,
        ].join("\n")
      )
    ),
    premiumZipCodes: "",
    premiumRecurringPricing: [1, 2, 3, 4, 5, 6].map(d => recurringEntry(d, "")),
    ...overrides,
  });

  it("replaces only the three configured custom values", async () => {
    const caller = createCaller();
    const result = await caller.pricing.saveSettings(validInput());

    expect(result.success).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const payload = mockedUpdate.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual([
      "add_on_pricing",
      "initial_and_recurring_pricing",
      "onetime_pricing",
    ]);
    expect(payload.initial_and_recurring_pricing).toContain(
      "# Initial Service Pricing for 3 Dogs"
    );
    expect(payload.initial_and_recurring_pricing).toContain(
      "# Fixed Quotes for Recurring Services:"
    );
    expect(payload.initial_and_recurring_pricing).toContain(
      "## Recurring Service Prices for 3 Dogs"
    );
    expect(payload.initial_and_recurring_pricing).toContain(
      "## Recurring Service Premium Prices for 6+ Dogs"
    );
    expect(payload.onetime_pricing).toContain(
      "# One-Time Service Pricing For 3 DOGS:"
    );
  });

  it("never creates fields — updateExistingCustomValuesOnly only updates existing values", async () => {
    const caller = createCaller();
    await caller.pricing.saveSettings(validInput());
    // The service contract is update-only; verify our code path uses it (no POST).
    expect(updateExistingCustomValuesOnly).toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports missing existing custom values instead of claiming success", async () => {
    mockedUpdate.mockResolvedValueOnce({
      missingKeys: ["add_on_pricing"],
      failedKeys: [],
    });
    const caller = createCaller();
    await expect(caller.pricing.saveSettings(validInput())).rejects.toThrow(
      /Missing custom values: add_on_pricing/
    );
  });

  it("rejects lines without a rate, N/A, or not-offered status", async () => {
    const caller = createCaller();
    const bad = validInput();
    bad.regularRecurringPricing[0] = recurringEntry(
      1,
      "Monthly Recurring Quote Rate for 1 dog: twenty"
    );
    await expect(caller.pricing.saveSettings(bad)).rejects.toThrow(
      /must contain a rate/
    );
  });

  it("accepts extra future frequency lines (e.g. 3x weekly)", async () => {
    const caller = createCaller();
    const input = JSON.parse(JSON.stringify(validInput()));
    input.regularRecurringPricing[0] = recurringEntry(
      1,
      [
        "### 2x weekly Recurring Quote Rate for 1 dog: $18.69 per service",
        "### Weekly Recurring Quote Rate for 1 dog: $21.00 per service",
        "### 3x weekly Recurring Quote Rate for 1 dog: $25.00 per service",
        "### Monthly Recurring Quote Rate for 1 dog: $70",
      ].join("\n")
    );
    const result = await caller.pricing.saveSettings(input);
    expect(result.success).toBe(true);
  });

  it("accepts N/A and not-offered status lines", async () => {
    const caller = createCaller();
    const input = validInput();
    input.regularRecurringPricing[0] = recurringEntry(
      1,
      [
        "### Biweekly Recurring Quote Rate for 1 dog: N/A",
        "### Monthly Recurring Quote Rate for 1 dog: not offered currently",
      ].join("\n")
    );
    const result = await caller.pricing.saveSettings(input);
    expect(result.success).toBe(true);
  });

  it("rejects invalid ZIP codes", async () => {
    const caller = createCaller();
    await expect(
      caller.pricing.saveSettings(
        validInput({ regularZipCodes: "9750, 97502" })
      )
    ).rejects.toThrow(/not a valid 5-digit ZIP code/);
  });

  it("allows empty premium zip codes", async () => {
    const caller = createCaller();
    const result = await caller.pricing.saveSettings(
      validInput({ premiumZipCodes: "" })
    );
    expect(result.success).toBe(true);
  });

  it("saves recurring text verbatim with the client's line wording", async () => {
    const caller = createCaller();
    const input = JSON.parse(JSON.stringify(validInput()));
    input.regularRecurringPricing[0] = recurringEntry(
      1,
      [
        "### 2x weekly Recurring Quote Rate for 1 dog: $18.69 per service",
        "### Weekly Recurring Quote Rate for 1 dog: $21.00 per service",
        "### Biweekly Recurring Quote Rate for 1 dog: $21.00 per service",
        "### 3x weekly Recurring Quote Rate for 1 dog: $25.00 per service",
        "### Monthly Recurring Quote Rate for 1 dog: $70",
      ].join("\n")
    );
    await caller.pricing.saveSettings(input);
    const payload = mockedUpdate.mock.calls[0][1];
    expect(payload["initial_and_recurring_pricing"]).toContain(
      "### Weekly Recurring Quote Rate for 1 dog: $21.00 per service"
    );
    expect(payload["initial_and_recurring_pricing"]).toContain(
      "### Monthly Recurring Quote Rate for 1 dog: $70"
    );
    // Extra frequency lines are preserved exactly as typed
    expect(payload["initial_and_recurring_pricing"]).toContain(
      "3x weekly Recurring Quote Rate"
    );
    expect(payload["initial_and_recurring_pricing"]).toContain("$35");
    expect(payload["onetime_pricing"]).toContain("$75");
    expect(Object.keys(payload)).not.toContain("faq_price_list");
    expect(Object.keys(payload)).not.toContain("regular_recurring_pricing");
  });

  it("maps empty locationId to a BAD_REQUEST", async () => {
    const caller = createCaller();
    await expect(
      caller.pricing.saveSettings(validInput({ locationId: "  " }))
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED on GHL 401", async () => {
    // NOTE: validation runs before the GHL call, so 401 only surfaces when the input
    // is otherwise valid and the mocked GHL service rejects on update/upsert.
    mockedUpdate.mockRejectedValue(
      new Error("GHL request failed: 401 Unauthorized")
    );
    const caller = createCaller();
    await expect(caller.pricing.saveSettings(validInput())).rejects.toThrow(
      /authentication failed/i
    );
  });
});
