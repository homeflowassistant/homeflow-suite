import { describe, expect, it } from "vitest";
import {
  buildFollowUpOffer2CustomValueUpdates,
  buildReactivationOfferCustomValueUpdates,
  readReactivationOfferCustomValues,
} from "./quoteOfferMappings.js";

function readReactivationOffer(values: Record<string, string>) {
  return readReactivationOfferCustomValues(
    key => values[key] ?? "",
    key => Object.prototype.hasOwnProperty.call(values, key)
  );
}

describe("Follow Up and Reactivation quote custom-value ownership", () => {
  it("writes Follow Up Offer 2 only to the three leads_line_item_2 values", () => {
    const updates = buildFollowUpOffer2CustomValueUpdates({
      title: "Follow Up offer",
      description: "Follow Up description",
      image: "https://example.com/follow-up.png",
    });

    expect(updates).toEqual({
      leads_line_item_2: "Follow Up offer",
      leads_line_item_description_2: "Follow Up description",
      leads_line_item_image_2: "https://example.com/follow-up.png",
    });
  });

  it("writes Reactivation to the one-time and recurring values, not the leads values", () => {
    const updates = buildReactivationOfferCustomValueUpdates({
      title: "Reactivation offer",
      description: "Reactivation description",
      image: "https://example.com/reactivation.png",
    });

    expect(updates).toEqual({
      onetime_line_item_1: "Reactivation offer",
      onetime_line_item_description_1: "Reactivation description",
      onetime_line_item_image_1: "https://example.com/reactivation.png",
      recurring_line_item_1: "Reactivation offer",
      recurring_line_item_description_1: "Reactivation description",
      recurring_line_item_image_1: "https://example.com/reactivation.png",
      discountfree_offer_for_reengagement_campaigns: "Reactivation offer",
    });
    expect(Object.keys(updates)).not.toContain("leads_line_item_2");
    expect(Object.keys(updates)).not.toContain("leads_line_item_description_2");
    expect(Object.keys(updates)).not.toContain("leads_line_item_image_2");
  });

  it("does not read Follow Up values when Reactivation values are absent", () => {
    expect(
      readReactivationOffer({
        leads_line_item_2: "Follow Up offer",
        leads_line_item_description_2: "Follow Up description",
        leads_line_item_image_2: "https://example.com/follow-up.png",
      })
    ).toEqual({ title: "", description: "", image: "" });
  });

  it("loads Reactivation from its one-time and recurring keys first", () => {
    expect(
      readReactivationOffer({
        onetime_line_item_1: "Reactivation offer",
        recurring_line_item_1: "Recurring offer",
        onetime_line_item_description_1: "Reactivation description",
        recurring_line_item_description_1: "Recurring description",
        onetime_line_item_image_1: "https://example.com/reactivation.png",
        recurring_line_item_image_1: "https://example.com/recurring.png",
        leads_line_item_2: "Follow Up offer",
        leads_line_item_description_2: "Follow Up description",
        leads_line_item_image_2: "https://example.com/follow-up.png",
      })
    ).toEqual({
      title: "Reactivation offer",
      description: "Reactivation description",
      image: "https://example.com/reactivation.png",
    });
  });

  it("preserves intentionally blank canonical values instead of loading another page’s offer", () => {
    expect(
      readReactivationOffer({
        onetime_line_item_1: "",
        recurring_line_item_1: "Recurring offer",
        onetime_line_item_description_1: "",
        recurring_line_item_description_1: "Recurring description",
        onetime_line_item_image_1: "",
        recurring_line_item_image_1: "https://example.com/recurring.png",
        leads_line_item_2: "Follow Up offer",
        leads_line_item_description_2: "Follow Up description",
        leads_line_item_image_2: "https://example.com/follow-up.png",
      })
    ).toEqual({ title: "", description: "", image: "" });
  });
});
