import { getValidAccessToken } from "../ghl-service.js";

export async function getLocationAccessToken(
  locationId: string
): Promise<string> {
  return getValidAccessToken(locationId);
}
