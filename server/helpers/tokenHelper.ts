import { getValidAccessToken } from "../ghl-service";

export async function getLocationAccessToken(locationId: string): Promise<string> {
  return getValidAccessToken(locationId);
}