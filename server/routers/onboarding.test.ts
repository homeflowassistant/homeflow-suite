import { describe, expect, it } from "vitest";
import { buildOnboardingResults, type OnboardingPageResult } from "./onboarding.js";

function page(results: OnboardingPageResult[], id: string) {
  const found = results.find(item => item.id === id);
  if (!found) throw new Error(`Missing page ${id}`);
  return found;
}

const customValue = (fieldKey: string, value: string) => ({
  id: fieldKey,
  fieldKey,
  name: fieldKey,
  value,
});

const baseOptions = {
  customFields: [],
  customValuesAvailable: true,
  customFieldsAvailable: true,
  connected: true,
};

describe("onboarding wizard validation", () => {
  it("marks missing and empty custom values as incomplete", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [customValue("homeflow_business_name", "")],
    });
    const accountSetup = page(results, "account-setup");
    expect(accountSetup.status).toBe("incomplete");
    expect(accountSetup.requirements.find(item => item.id === "business-name-homeflow")?.status).toBe("incomplete");
    expect(accountSetup.requirements.find(item => item.id === "business-email")?.reason).toContain("missing");
  });

  it("adds custom quote requirements only when Custom Quote & Link is selected", () => {
    const base = buildOnboardingResults({ ...baseOptions, customValues: [customValue("lead_followup_options", "Lite")] });
    const customQuote = buildOnboardingResults({ ...baseOptions, customValues: [customValue("lead_followup_options", "Custom-Link")] });
    expect(page(base, "request-scheduling").requirements.some(item => item.id === "quote-company-name")).toBe(false);
    expect(page(customQuote, "request-scheduling").requirements.some(item => item.id === "quote-company-name")).toBe(true);
    expect(page(customQuote, "reactivation").requirements.some(item => item.id === "reactivation-company-image")).toBe(true);
  });

  it("contains exactly the ten requested sequential steps", () => {
    const results = buildOnboardingResults({ ...baseOptions, customValues: [] });
    expect(results.map(item => item.id)).toEqual([
      "account-setup",
      "pricing",
      "request-scheduling",
      "reactivation",
      "add-on-campaign",
      "quick-send",
      "alerts-notifications",
      "integrations",
      "contacts",
      "zapier",
    ]);
    expect(results.some(item => item.id === "contacts-custom-fields")).toBe(false);
    expect(results.some(item => item.id === "campaign-tags")).toBe(false);
    expect(results.some(item => item.id === "review-test")).toBe(false);
  });

  it("blocks required pages when the GHL location is not connected", () => {
    const results = buildOnboardingResults({
      customValues: [],
      customFields: [],
      customValuesAvailable: false,
      customFieldsAvailable: false,
      connected: false,
    });
    expect(results.filter(item => item.required && item.status === "blocked").length).toBeGreaterThan(0);
    expect(page(results, "account-setup").requirements.every(item => item.status === "blocked")).toBe(true);
  });

  it("rejects placeholder pricing values", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue("initial_and_recurring_pricing", "Initial service: $XX"),
        customValue("onetime_pricing", "One-time service: $75"),
        customValue("add_on_pricing", "Add-on: N/A"),
      ],
    });
    expect(page(results, "pricing").status).toBe("incomplete");
    expect(page(results, "pricing").requirements.find(item => item.id === "pricing-initial-recurring")?.reason).toContain("placeholder");
  });

  it("treats an optional campaign as skipped rather than complete", () => {
    const results = buildOnboardingResults({ ...baseOptions, customValues: [], skippedStepIds: new Set(["reactivation"]) });
    expect(page(results, "reactivation").status).toBe("skipped");
    expect(page(results, "reactivation").complete).toBe(false);
    expect(page(results, "reactivation").skipped).toBe(true);
  });
});
