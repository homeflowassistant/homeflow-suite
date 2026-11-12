/**
 * Placeholder images in the quote popups are app-relative paths such as
 * "/dog-photo.webp". Saved to GHL as-is they break everywhere outside this
 * app (the customer's quote page, emails, n8n), so turn them into a full URL
 * on this app's origin before saving. Hosted URLs and base64 uploads are
 * returned unchanged.
 */
export function toAbsoluteAssetUrl(
  value: string | null | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : ""
): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && origin) {
    return new URL(value, origin).href;
  }
  return value;
}
