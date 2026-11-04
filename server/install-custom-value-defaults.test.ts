import { describe, expect, it } from "vitest";
import { INSTALL_CUSTOM_VALUE_DEFAULTS } from "./install-custom-value-defaults.js";

describe("new subaccount install custom-value defaults", () => {
  it("includes the approved line-item, email subdomain, and Reactivation timing values", () => {
    expect(INSTALL_CUSTOM_VALUE_DEFAULTS).toEqual([
      {
        name: "leads_line_item_1",
        value: "[FREQUENCY] | Dog Waste Removal",
      },
      {
        name: "email_sending_subdomain_after_the_",
        value: "send.homeflowassistant.com",
      },
      {
        name: "onetime_service_reactivation_scheduling",
        value: "Never",
      },
    ]);
  });
});
