import { describe, expect, it } from "vitest";
import { FOLLOW_UP_OPTION_TO_GHL_VALUE } from "./requestScheduling.js";

describe("Follow Up option custom-value mapping", () => {
  it("stores the expected workflow values in lead_followup_options", () => {
    expect(FOLLOW_UP_OPTION_TO_GHL_VALUE).toEqual({
      Lite: "Lite",
      "S&G Link": "SG-Link",
      "Custom Quote & Link": "Custom-Link",
    });
  });
});
