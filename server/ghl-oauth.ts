/**
 * GHL OAuth Callback Route
 *
 * Handles the OAuth redirect from GoHighLevel after a sub-account installs the app.
 * Implements the same two-step flow as Royal Review:
 *   1. OAuth callback exchanges the auth code for tokens and stores the agency-level token
 *   2. Webhook endpoint receives INSTALL events, exchanges agency token for a location
 *      token, stores it, and seeds default custom values
 *
 * Route: GET /api/ghl/oauth/callback?code=...
 */

import type { Express, Request, Response } from "express";
import {
  exchangeCodeForTokens,
  getAgencyInstallation,
  getInstallation,
  removeInstallation,
  upsertInstallation,
  updateCustomValuesOnInstall,
  getValidAccessToken,
} from "./ghl-service";

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exchanges an agency-level token for a location-specific token.
 * Called when GHL sends an INSTALL webhook for a sub-account.
 */
async function processLocationInstall(
  agencyToken: string,
  companyId: string,
  locationId: string
): Promise<void> {
  const maxAttempts = 3;
  const delayMs = Number(process.env.GHL_LOCATION_TOKEN_RETRY_DELAY_MS || 3000);

  console.log("[GHL Webhook] ========== LOCATION TOKEN EXCHANGE START ==========", {
    companyId,
    locationId,
  });

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[GHL Webhook] Attempt ${attempt}/${maxAttempts} — calling /oauth/locationToken`, {
        companyId,
        locationId,
      });

      const response = await fetch("https://services.leadconnectorhq.com/oauth/locationToken", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${agencyToken}`,
          Version: "2021-07-28",
        },
        body: new URLSearchParams({ companyId, locationId }).toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const parsedError = (() => {
          try {
            return JSON.parse(errorBody);
          } catch {
            return null;
          }
        })();
        const message =
          parsedError && typeof parsedError === "object" && "message" in parsedError
            ? String((parsedError as Record<string, unknown>).message)
            : errorBody;

        const isScopeError = /scope|oauth\.write|permission/i.test(message);
        const isUserTypeError = /user type|supported/i.test(message);
        console.error("[GHL Webhook] Location-token exchange FAILED", {
          attempt,
          maxAttempts,
          companyId,
          locationId,
          status: response.status,
          message,
          isScopeError,
          isUserTypeError,
        });

        lastError = new Error(`GHL location-token exchange failed: ${response.status} ${message}`);
        if (attempt < maxAttempts) {
          console.log(`[GHL Webhook] Retrying in ${delayMs}ms...`);
          await delay(delayMs);
          continue;
        }
        throw lastError;
      }

      const locationTokenResponse = (await response.json()) as { access_token?: string };
      if (!locationTokenResponse.access_token) {
        lastError = new Error("GHL location-token exchange returned no access token");
        console.error("[GHL Webhook] Location-token exchange FAILED — no access token in response", {
          companyId,
          locationId,
          attempt,
        });
        if (attempt < maxAttempts) {
          console.log(`[GHL Webhook] Retrying in ${delayMs}ms...`);
          await delay(delayMs);
          continue;
        }
        throw lastError;
      }

      await upsertInstallation(locationTokenResponse as Parameters<typeof upsertInstallation>[0], locationId);
      console.log("[GHL Webhook] ========== LOCATION TOKEN EXCHANGE SUCCESS ==========", {
        companyId,
        locationId,
        attempt,
        status: "SUCCESS",
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error("[GHL Webhook] Exception during token exchange", {
        attempt,
        companyId,
        locationId,
        error: lastError.message,
      });
      if (attempt < maxAttempts) {
        console.log(`[GHL Webhook] Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        continue;
      }
      throw lastError;
    }
  }

  console.error("[GHL Webhook] ========== LOCATION TOKEN EXCHANGE FAILED ==========", {
    companyId,
    locationId,
    attempts: maxAttempts,
    finalError: lastError?.message,
    status: "FAILED",
  });
  throw lastError ?? new Error("GHL location-token exchange failed");
}

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

      const companyId = tokenResponse.companyId;
      if (!companyId) {
        throw new Error("No companyId returned from GHL token exchange");
      }

      console.log("[GHL OAuth] Callback received", {
        companyId,
        scope: tokenResponse.scope,
        userType: tokenResponse.userType,
        isBulkInstallation: true,
      });

      if (tokenResponse.userType === "Company") {
        await upsertInstallation(tokenResponse, companyId);
        console.log(`[GHL OAuth] Agency token stored for companyId: ${companyId}`);
      } else if (tokenResponse.userType === "Location" && tokenResponse.locationId) {
        await upsertInstallation(tokenResponse, tokenResponse.locationId);
        console.log(`[GHL OAuth] Location token stored for locationId: ${tokenResponse.locationId}`);
      } else {
        await upsertInstallation(tokenResponse, companyId);
        console.log(`[GHL OAuth] Token stored for companyId: ${companyId}`);
      }

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
              <p style="color: #6b7280;">HomeFlow Suite has been connected to your GoHighLevel account.</p>
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

      if (payload.type === "INSTALL" && payload.locationId) {
        const { locationId, companyId, installType } = payload as {
          locationId?: string;
          companyId?: string;
          installType?: string;
        };

        console.log("[GHL Webhook] ========== INSTALL EVENT RECEIVED ==========", {
          type: payload.type,
          companyId,
          locationId,
          installType,
          timestamp: new Date().toISOString(),
        });

        if (!companyId || !locationId) {
          console.error("[GHL Webhook] FAILED — Missing companyId or locationId for install event");
          return res.status(400).json({ error: "Missing companyId or locationId" });
        }

        // Wait for the agency token to be available (may arrive after the webhook)
        const maxAttempts = 5;
        let agencyInstallation = await getAgencyInstallation(companyId);
        let attempt = 1;

        while (!agencyInstallation && attempt <= maxAttempts) {
          const waitMs = 3000 * 2 ** (attempt - 1);
          console.warn("[GHL Webhook] Agency token not ready; retrying", {
            companyId,
            locationId,
            attempt,
            waitMs,
          });
          await delay(waitMs);
          agencyInstallation = await getAgencyInstallation(companyId);
          attempt += 1;
        }

        if (!agencyInstallation) {
          console.error("[GHL Webhook] ========== INSTALL FAILED — Agency token not available ==========", {
            companyId,
            locationId,
            attempts: maxAttempts,
            status: "FAILED",
          });
          return res.status(500).json({ error: "Agency token not available for location install" });
        }

        console.log("[GHL Webhook] Agency token found", {
          companyId,
          locationId,
          hasAgencyToken: Boolean(agencyInstallation.accessToken),
        });

        const freshAgencyToken = await getValidAccessToken(companyId);

        try {
          await processLocationInstall(agencyInstallation.accessToken, companyId, locationId);
          console.log("[GHL Webhook] ========== INSTALL SUCCESS — Location token stored ==========", {
            companyId,
            locationId,
            status: "SUCCESS",
            timestamp: new Date().toISOString(),
          });
        } catch (locationError) {
          console.error("[GHL Webhook] ========== INSTALL FAILED — Location token exchange failed ==========", {
            companyId,
            locationId,
            error: locationError instanceof Error ? locationError.message : String(locationError),
            status: "FAILED",
            timestamp: new Date().toISOString(),
          });
          throw locationError;
        }

        try {
          await updateCustomValuesOnInstall(locationId);
          console.log("[GHL Webhook] ========== CUSTOM VALUE SEEDING SUCCESS ==========", {
            locationId,
            status: "SUCCESS",
            timestamp: new Date().toISOString(),
          });
        } catch (seedError) {
          console.error("[GHL Webhook] ========== CUSTOM VALUE SEEDING FAILED ==========", {
            locationId,
            error: seedError instanceof Error ? seedError.message : String(seedError),
            status: "FAILED",
            timestamp: new Date().toISOString(),
          });
        }
      } else if (payload.type === "UNINSTALL" && payload.locationId) {
        console.log("[GHL Webhook] ========== UNINSTALL EVENT RECEIVED ==========", {
          type: payload.type,
          locationId: payload.locationId,
          timestamp: new Date().toISOString(),
        });
        await removeInstallation(payload.locationId);
        console.log("[GHL Webhook] ========== UNINSTALL SUCCESS ==========", {
          locationId: payload.locationId,
          status: "SUCCESS",
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[GHL Webhook] Error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}
