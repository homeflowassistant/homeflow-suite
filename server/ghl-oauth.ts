/**
 * GHL OAuth Callback Route
 *
 * Handles the OAuth redirect from GoHighLevel after a sub-account installs the app.
 * Exchanges the authorization code for tokens and stores them in the database.
 *
 * Route: GET /api/ghl/oauth/callback?code=...
 */

import type { Express, Request, Response } from "express";
import {
  exchangeCodeForTokens,
  upsertInstallation,
} from "./ghl-service";

export function registerGHLOAuthRoutes(app: Express): void {
  /**
   * OAuth callback endpoint.
   * GHL redirects here after the user authorizes the app.
   * The `code` query parameter contains the authorization code.
   */
  app.get("/api/ghl/oauth/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;

    if (!code) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <h2 style="color: #dc2626;">Installation Failed</h2>
            <p>No authorization code received from GoHighLevel.</p>
            <p>Please try installing the app again from the GHL Marketplace.</p>
          </body>
        </html>
      `);
      return;
    }

    try {
      // Build the redirect URI (must match what's registered in GHL app settings)
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const redirectUri = `${protocol}://${host}/api/ghl/oauth/callback`;

      // Exchange authorization code for tokens
      const tokenResponse = await exchangeCodeForTokens(code, redirectUri);

      // Determine the locationId — GHL may return it in the token response
      // For sub-account level apps, locationId is included
      const locationId = tokenResponse.locationId;
      if (!locationId) {
        // If no locationId, this might be a company-level token
        // We'll store it with the companyId as a fallback
        console.warn("[GHL OAuth] No locationId in token response, using companyId");
      }

      const storageId = locationId || tokenResponse.companyId || "unknown";

      // Store the installation
      await upsertInstallation(tokenResponse, storageId);

      console.log(`[GHL OAuth] App installed successfully for location: ${storageId}`);

      // Show success page
      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <div style="max-width: 400px; margin: 0 auto;">
              <div style="width: 64px; height: 64px; background: #16a34a; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h2 style="color: #16a34a; margin-bottom: 8px;">App Installed Successfully!</h2>
              <p style="color: #6b7280;">Royal Review Add Contacts has been connected to your GoHighLevel account.</p>
              <p style="color: #6b7280; font-size: 14px;">You can now close this window and access the app from your GHL sidebar.</p>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("[GHL OAuth] Callback error:", error);
      res.status(500).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <h2 style="color: #dc2626;">Installation Failed</h2>
            <p>There was an error connecting to GoHighLevel.</p>
            <p style="color: #6b7280; font-size: 14px;">${error instanceof Error ? error.message : "Unknown error"}</p>
            <p>Please try installing the app again.</p>
          </body>
        </html>
      `);
    }
  });

  /**
   * Webhook endpoint for GHL app install events.
   * GHL sends a POST when the app is installed/uninstalled.
   */
  app.post("/api/ghl/webhook", async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      console.log("[GHL Webhook] Received:", JSON.stringify(payload));

      if (payload.type === "INSTALL") {
        console.log(`[GHL Webhook] App installed for location: ${payload.locationId}`);
      } else if (payload.type === "UNINSTALL") {
        console.log(`[GHL Webhook] App uninstalled for location: ${payload.locationId}`);
        // Optionally: remove the installation from DB
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[GHL Webhook] Error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}
