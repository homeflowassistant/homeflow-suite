import { describe, expect, it } from "vitest";
import {
  buildOnboardingResults,
  type OnboardingPageResult,
} from "./onboarding.js";

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
    expect(
      accountSetup.requirements.find(
        item => item.id === "business-name-homeflow"
      )?.status
    ).toBe("incomplete");
    expect(
      accountSetup.requirements.find(item => item.id === "business-email")
        ?.reason
    ).toContain("missing");
  });

  it("adds custom quote requirements only when Custom Quote & Link is selected", () => {
    const base = buildOnboardingResults({
      ...baseOptions,
      customValues: [customValue("lead_followup_options", "Lite")],
    });
    const customQuote = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue("lead_followup_options", "Custom-Link"),
        customValue("reactivation_options", "Custom-Link"),
      ],
    });
    const has = (results: OnboardingPageResult[], pageId: string, id: string) =>
      page(results, pageId).requirements.some(item => item.id === id);
    expect(has(base, "request-scheduling", "quote-title")).toBe(false);
    expect(has(customQuote, "request-scheduling", "quote-title")).toBe(true);
    // Company Name is entered on Account Setup, not in the quote popup.
    expect(has(customQuote, "request-scheduling", "quote-company-name")).toBe(
      false
    );
    expect(has(customQuote, "reactivation", "reactivation-company-image")).toBe(
      true
    );
  });

  it("checks exactly the fields shown on Account Setup", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [],
    });
    const keys = page(results, "account-setup").requirements.map(r => r.key);
    expect(keys).toEqual([
      "homeflow_business_name",
      "company_name",
      "homeflow_business_owner_name",
      "business_email",
      "business_phone",
      "homeflow_business_logo",
      "company_logo",
      "add_payment_link",
      "facebook_page_link",
      "discountfree_offer_for_lead_campaigns",
      "discountfree_offer_for_reengagement_campaigns",
      "legal_business_name",
      "business_address",
      "business_ein",
      "state_two_letter_abbrev",
      "confirmation_page_link",
      "on_the_way_notifications_truefalse",
      "job_completed_notifications_truefalse",
      "off_schedule_notifications_truefalse",
    ]);
    // Internal notification values are not on this page any more (#31).
    expect(keys).not.toContain("internal_notifications_email");
    // EIN is optional: listed, but never blocks the step.
    expect(
      page(results, "account-setup").requirements.find(
        r => r.key === "business_ein"
      )?.required
    ).toBe(false);
  });

  it("Account Setup completes when every required page field is filled (EIN optional)", () => {
    const filled = [
      "homeflow_business_name",
      "company_name",
      "homeflow_business_owner_name",
      "business_email",
      "business_phone",
      "homeflow_business_logo",
      "company_logo",
      "add_payment_link",
      "facebook_page_link",
      "discountfree_offer_for_lead_campaigns",
      "discountfree_offer_for_reengagement_campaigns",
      "legal_business_name",
      "business_address",
      "state_two_letter_abbrev",
      "confirmation_page_link",
      "on_the_way_notifications_truefalse",
      "job_completed_notifications_truefalse",
      "off_schedule_notifications_truefalse",
    ].map(key => customValue(key, key.endsWith("truefalse") ? "False" : "x"));
    const accountSetup = page(
      buildOnboardingResults({ ...baseOptions, customValues: filled }),
      "account-setup"
    );
    expect(accountSetup.status).toBe("complete");
    expect(accountSetup.missingCount).toBe(1); // only the optional EIN
  });

  it("requires the base onboarding link only when S&G Link is selected", () => {
    const sg = buildOnboardingResults({
      ...baseOptions,
      customValues: [customValue("lead_followup_options", "SG-Link")],
    });
    const lite = buildOnboardingResults({
      ...baseOptions,
      customValues: [customValue("lead_followup_options", "Lite")],
    });
    const ids = (r: OnboardingPageResult[]) =>
      page(r, "request-scheduling").requirements.map(item => item.id);
    expect(ids(sg)).toContain("sg-base-onboarding-link");
    expect(ids(lite)).not.toContain("sg-base-onboarding-link");
    // Contact fields and the hidden follow-up limit are not page fields.
    expect(ids(lite)).toEqual([
      "lead-followup-option",
      "initial-outreach-timing",
    ]);
  });

  it("Reactivation checks its own option value", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue("lead_followup_options", "Custom-Link"),
        customValue("reactivation_options", "Lite"),
      ],
    });
    const reactivation = page(results, "reactivation");
    expect(reactivation.requirements.map(r => r.key)).toEqual([
      "reactivation_options",
      "onetime_service_reactivation_scheduling",
    ]);
    expect(
      reactivation.requirements.find(r => r.id === "reactivation-option")
        ?.status
    ).toBe("complete");
  });

  it("Facebook Setup is complete only when the page answer is yes", () => {
    const status = (value: string) =>
      page(
        buildOnboardingResults({
          ...baseOptions,
          customValues: [customValue("facebook_setup_status", value)],
        }),
        "facebook-setup"
      ).requirements[0];
    expect(status("yes").status).toBe("complete");
    expect(status("not-yet").status).toBe("incomplete");
    expect(status("not-yet").reason).toContain("not done");
  });

  it("contains the requested sequential steps including Facebook Setup", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [],
    });
    expect(results.map(item => item.id)).toEqual([
      "account-setup",
      "pricing",
      "request-scheduling",
      "reactivation",
      "add-on-campaign",
      "alerts-notifications",
      "integrations",
      "facebook-setup",
    ]);
    expect(results).toHaveLength(8);
    expect(results.some(item => item.id === "contacts")).toBe(false);
    expect(results.some(item => item.id === "quick-send")).toBe(false);
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
    expect(
      results.filter(item => item.required && item.status === "blocked").length
    ).toBeGreaterThan(0);
    expect(
      page(results, "account-setup").requirements.every(
        item => item.status === "blocked"
      )
    ).toBe(true);
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
    expect(
      page(results, "pricing").requirements.find(
        item => item.id === "pricing-initial-recurring"
      )?.reason
    ).toContain("placeholder");
    // The mislabelled add_on_pricing check was removed (#30).
    expect(
      page(results, "pricing").requirements.find(
        item => item.id === "pricing-add-ons"
      )
    ).toBeUndefined();
  });

  it("treats an optional campaign as skipped rather than complete", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [],
      skippedStepIds: new Set(["reactivation"]),
    });
    expect(page(results, "reactivation").status).toBe("skipped");
    expect(page(results, "reactivation").complete).toBe(false);
    expect(page(results, "reactivation").skipped).toBe(true);
  });

  it("treats a required setup page as skipped when the user chooses Skip Step", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [],
      skippedStepIds: new Set(["account-setup"]),
    });
    expect(page(results, "account-setup").status).toBe("skipped");
    expect(page(results, "account-setup").skipped).toBe(true);
  });

  it("finds paused/unpaused values saved under their alternative GHL names (#30)", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        { id: "t", name: "Subscription Paused Message", value: "True" },
        {
          id: "p",
          name: "Custom Subscription Paused Message",
          value: "Your service has been paused.",
        },
        {
          id: "u",
          name: "Custom Subscription Unpaused Message",
          value: "Your service has been unpaused.",
        },
      ],
    });
    const alerts = page(results, "alerts-notifications");
    const req = (id: string) =>
      alerts.requirements.find(item => item.id === id);
    expect(req("alert-subscription-toggle")?.status).toBe("complete");
    expect(req("alert-subscription-paused-message")?.status).toBe("complete");
    expect(req("alert-subscription-unpaused-message")?.status).toBe("complete");
  });

  it("does not let the paused toggle match the paused message", () => {
    // Only the message exists: the toggle must still be reported missing.
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue("custom_subscription_pausedunpaused_message", "Paused!"),
      ],
    });
    const alerts = page(results, "alerts-notifications");
    expect(
      alerts.requirements.find(item => item.id === "alert-subscription-toggle")
        ?.status
    ).toBe("incomplete");
    expect(
      alerts.requirements.find(
        item => item.id === "alert-subscription-paused-message"
      )?.status
    ).toBe("complete");
  });

  it("pricing has only two checks and accepts unused $XX lines (#30)", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue(
          "initial_and_recurring_pricing",
          "# Initial Service Pricing for 1 Dog\n### One week OR less: $45 (1 dog)\n## Recurring Service Premium Prices for 6+ Dogs: $XX"
        ),
        customValue(
          "onetime_pricing",
          "## One-Time Quote Rate: $60 per service"
        ),
        customValue("add_on_pricing", "Add-on name: $XX per visit"),
      ],
    });
    const pricing = page(results, "pricing");
    expect(pricing.requirements.map(item => item.id)).toEqual([
      "pricing-initial-recurring",
      "pricing-one-time",
    ]);
    expect(pricing.status).toBe("complete");
  });

  it("still flags pricing that is only the untouched $XX template", () => {
    const results = buildOnboardingResults({
      ...baseOptions,
      customValues: [
        customValue(
          "initial_and_recurring_pricing",
          "### One week OR less: $XX (1 dog)\n### 1 Month: $XX (1 dog)"
        ),
        customValue("onetime_pricing", "## One-Time Quote Rate: $60"),
      ],
    });
    const initial = page(results, "pricing").requirements.find(
      item => item.id === "pricing-initial-recurring"
    );
    expect(initial?.status).toBe("incomplete");
    expect(initial?.reason).toContain("placeholder");
  });
});
