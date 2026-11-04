export type QuoteOfferValues = {
  title?: string | null;
  description?: string | null;
  image?: string | null;
};

/**
 * Follow Up owns the Leads Line Item 2 values. Keep this mapping limited to
 * those three fields so saving the Follow Up quote cannot overwrite Reactivation.
 */
export function buildFollowUpOffer2CustomValueUpdates(
  offer: QuoteOfferValues
): Record<string, string> {
  return {
    leads_line_item_2: offer.title ?? "",
    leads_line_item_description_2: offer.description ?? "",
    leads_line_item_image_2: offer.image ?? "",
  };
}

/**
 * Reactivation owns both one-time and recurring Free Sign Up values. The
 * reengagement title value is retained as a Reactivation-only compatibility
 * value used by Account Set Up and existing workflows. No Leads Line Item 2
 * values are written here.
 */
export function buildReactivationOfferCustomValueUpdates(
  offer: QuoteOfferValues
): Record<string, string> {
  const title = offer.title ?? "";
  const description = offer.description ?? "";
  const image = offer.image ?? "";

  return {
    onetime_line_item_1: title,
    onetime_line_item_description_1: description,
    onetime_line_item_image_1: image,
    recurring_line_item_1: title,
    recurring_line_item_description_1: description,
    recurring_line_item_image_1: image,
    discountfree_offer_for_reengagement_campaigns: title,
  };
}

/**
 * Load Reactivation's canonical one-time/recurring values only. The separate
 * reengagement title is a legacy fallback for accounts that predate the
 * canonical title fields. Follow Up's leads_line_item_2 values are never read.
 */
export function readReactivationOfferCustomValues(
  get: (key: string) => string,
  hasKey: (key: string) => boolean
): { title: string; description: string; image: string } {
  const firstPresent = (keys: string[]): string => {
    for (const key of keys) {
      if (hasKey(key)) return get(key);
    }
    return "";
  };

  return {
    title: firstPresent([
      "onetime_line_item_1",
      "recurring_line_item_1",
      "discountfree_offer_for_reengagement_campaigns",
    ]),
    description: firstPresent([
      "onetime_line_item_description_1",
      "recurring_line_item_description_1",
    ]),
    image: firstPresent([
      "onetime_line_item_image_1",
      "recurring_line_item_image_1",
    ]),
  };
}
