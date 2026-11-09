import { TRPCError } from "@trpc/server";
import {
  describeUnsavedCustomValues,
  saveGhlCustomValues,
  uploadToGhlMedia,
  type CustomValueSaveOptions,
  type CustomValueSaveResult,
} from "../ghl-service.js";

/**
 * Save custom values and fail loudly unless GHL stored every one of them,
 * so a settings page can never show "Saved" for values that were dropped.
 */
export async function saveCustomValuesOrThrow(
  locationId: string,
  updates: Record<string, string>,
  label: string,
  options?: CustomValueSaveOptions
): Promise<CustomValueSaveResult> {
  const result = await saveGhlCustomValues(locationId, updates, options);
  const unsaved = describeUnsavedCustomValues(result);
  if (unsaved) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${label}: some GHL Custom Values were not saved (${unsaved}). Please try again.`,
    });
  }
  return result;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

/**
 * Turn an image field into the value stored in GHL. Hosted URLs pass through,
 * base64 data URIs are uploaded to the GHL media library. A failed upload
 * throws instead of returning "" — previously a failed upload silently
 * overwrote the saved image with an empty value.
 */
export async function resolveImageCustomValue(
  locationId: string,
  value: string | undefined,
  baseName: string
): Promise<string> {
  if (!value) return "";
  if (!value.startsWith("data:image")) return value;

  const mimeMatch = value.match(/^data:([A-Za-z-+\/]+);/);
  const ext = mimeMatch ? MIME_TO_EXT[mimeMatch[1]] || ".png" : ".png";
  const fileName = `${baseName}_${Date.now()}${ext}`;
  const url = await uploadToGhlMedia(locationId, value, fileName);
  if (!url || url.startsWith("data:")) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `The image '${baseName}' could not be uploaded to the GHL media library, so the quote was not saved. Please try again.`,
    });
  }
  return url;
}
