import type { Express, Request, Response } from "express";
import {
  checkLocationAccess,
  createLocationSessionToken,
  decodeGhlSsoPayload,
  getAuthMode,
} from "../_core/ghlSso.js";

/**
 * Express guard for location-scoped routes called by the HomeFlow frontend.
 * Returns false (and sends the response) when access is denied.
 */
export async function requireLocationSession(
  req: Request,
  res: Response,
  locationId: string | undefined
): Promise<boolean> {
  const access = await checkLocationAccess(req, locationId);
  if (access.ok) return true;
  res.status(access.status).json({
    success: false,
    code: access.status === 401 ? "SESSION_REQUIRED" : "LOCATION_FORBIDDEN",
    message: access.message,
  });
  return false;
}

export function registerAuthRoutes(app: Express): void {
  /** Lets the frontend know whether it must obtain an SSO session. */
  app.get("/api/auth/config", (_req: Request, res: Response) => {
    res.json({ ssoEnabled: getAuthMode() !== "off" });
  });

  /**
   * Exchange the encrypted HighLevel SSO payload (from the parent window's
   * REQUEST_USER_DATA_RESPONSE message) for a HomeFlow session token.
   */
  app.post("/api/auth/ghl-sso", async (req: Request, res: Response) => {
    if (getAuthMode() === "off") {
      res.status(404).json({
        success: false,
        code: "SSO_NOT_CONFIGURED",
        message: "HighLevel SSO is not configured on this server.",
      });
      return;
    }

    const payload =
      typeof req.body?.payload === "string" ? req.body.payload.trim() : "";
    if (!payload || payload.length > 20_000) {
      res.status(400).json({
        success: false,
        code: "SSO_PAYLOAD_REQUIRED",
        message: "A HighLevel SSO payload is required.",
      });
      return;
    }

    try {
      const user = decodeGhlSsoPayload(payload);
      const session = await createLocationSessionToken(user);
      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        activeLocation: user.activeLocation ?? null,
        userType: user.userType,
      });
    } catch (error) {
      console.warn("[Auth] Rejected HighLevel SSO payload", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(401).json({
        success: false,
        code: "SSO_PAYLOAD_INVALID",
        message: "The HighLevel SSO payload could not be verified.",
      });
    }
  });
}
