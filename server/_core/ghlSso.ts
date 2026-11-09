/**
 * HighLevel SSO + per-location session authorization.
 *
 * Inside the HighLevel sidebar the app asks the parent window for the current
 * user (postMessage "REQUEST_USER_DATA"). HighLevel answers with a payload
 * encrypted (CryptoJS AES, passphrase mode) with the Marketplace app's
 * Shared Secret ("SSO key"). The server decrypts it, and issues a short-lived
 * HomeFlow session token bound to the user's company and active location.
 * Every location-scoped API call must then carry that token in the
 * `x-homeflow-session` header, and may only act on a location the token
 * allows.
 *
 * Rollout safety: enforcement is OFF until GHL_APP_SSO_KEY is configured, so
 * deploying this code changes nothing until the key is set. Set
 * HOMEFLOW_AUTH_MODE=report to only log violations while verifying.
 */
import { createDecipheriv, createHash } from "crypto";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { getInstallation } from "../ghl-service.js";
import { ENV } from "./env.js";

export const SESSION_HEADER = "x-homeflow-session";
export const LOCATION_AUTH_REQUIRED_MSG =
  "Your HomeFlow session is missing or expired. Please reopen HomeFlow from your HighLevel sidebar. (20001)";
export const LOCATION_FORBIDDEN_MSG =
  "You do not have access to this HighLevel location. (20002)";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_TOKEN_TYPE = "homeflow-location-session";

export type GhlSsoUser = {
  userId: string;
  companyId: string;
  activeLocation?: string;
  userType: "agency" | "location" | string;
  role?: string;
  userName?: string;
  email?: string;
};

export type LocationSession = {
  userId: string;
  companyId: string;
  activeLocation: string | null;
  userType: string;
  role: string | null;
};

export type AuthMode = "off" | "report" | "enforce";

export function getAuthMode(): AuthMode {
  if (!ENV.ghlSsoKey) return "off";
  const mode = ENV.authMode.trim().toLowerCase();
  if (mode === "off" || mode === "report") return mode;
  return "enforce";
}

let warnedDisabled = false;
export function warnIfAuthDisabled(): void {
  if (getAuthMode() === "off" && !warnedDisabled) {
    warnedDisabled = true;
    console.warn(
      "[Auth] GHL_APP_SSO_KEY is not configured — location-scoped endpoints are NOT protected. Set it to your HighLevel Marketplace app's Shared Secret to enable authorization."
    );
  }
}

// ─── CryptoJS-compatible AES decryption ──────────────────────────────

function evpBytesToKey(password: Buffer, salt: Buffer) {
  const buffers: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  let total = 0;
  while (total < 48) {
    previous = createHash("md5")
      .update(Buffer.concat([previous, password, salt]))
      .digest();
    buffers.push(previous);
    total += previous.length;
  }
  const derived = Buffer.concat(buffers);
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

/** Decrypt a CryptoJS.AES.encrypt(text, passphrase) string. */
export function decryptCryptoJsAes(payload: string, passphrase: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 17 || raw.subarray(0, 8).toString("latin1") !== "Salted__") {
    throw new Error("SSO payload is not in the expected encrypted format");
  }
  const salt = raw.subarray(8, 16);
  const ciphertext = raw.subarray(16);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function decodeGhlSsoPayload(payload: string): GhlSsoUser {
  if (!ENV.ghlSsoKey) throw new Error("GHL_APP_SSO_KEY is not configured");
  const data = JSON.parse(decryptCryptoJsAes(payload, ENV.ghlSsoKey)) as Record<
    string,
    unknown
  >;
  const userId = text(data.userId);
  const companyId = text(data.companyId);
  if (!userId || !companyId) {
    throw new Error("SSO payload is missing userId or companyId");
  }
  return {
    userId,
    companyId,
    activeLocation: text(data.activeLocation),
    userType: text(data.type) ?? "location",
    role: text(data.role),
    userName: text(data.userName),
    email: text(data.email),
  };
}

// ─── Session tokens ──────────────────────────────────────────────────

function sessionSecret(): Uint8Array {
  const secret = ENV.cookieSecret || ENV.ghlSsoKey;
  if (!secret) throw new Error("No secret available to sign sessions");
  return new TextEncoder().encode(`homeflow-location-session:${secret}`);
}

export async function createLocationSessionToken(
  user: GhlSsoUser
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await new SignJWT({
    typ: SESSION_TOKEN_TYPE,
    companyId: user.companyId,
    activeLocation: user.activeLocation ?? null,
    userType: user.userType,
    role: user.role ?? null,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(sessionSecret());
  return { token, expiresAt: expiresAt * 1000 };
}

export async function verifyLocationSessionToken(
  token: string | undefined | null
): Promise<LocationSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.typ !== SESSION_TOKEN_TYPE) return null;
    const userId = text(payload.sub);
    const companyId = text(payload.companyId);
    if (!userId || !companyId) return null;
    return {
      userId,
      companyId,
      activeLocation: text(payload.activeLocation) ?? null,
      userType: text(payload.userType) ?? "location",
      role: text(payload.role) ?? null,
    };
  } catch {
    return null;
  }
}

export function getSessionTokenFromRequest(req: Request): string | undefined {
  const header = req.headers[SESSION_HEADER];
  return text(Array.isArray(header) ? header[0] : header);
}

// ─── Authorization ───────────────────────────────────────────────────

export type LocationAccessResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

/**
 * A session may act on its active location. Agency users may also act on any
 * location installed under their own company.
 */
export async function checkLocationAccess(
  req: Request,
  locationId: string | undefined
): Promise<LocationAccessResult> {
  const mode = getAuthMode();
  if (mode === "off") {
    warnIfAuthDisabled();
    return { ok: true };
  }

  const deny = (
    status: 401 | 403,
    message: string,
    reason: string
  ): LocationAccessResult => {
    console.warn("[Auth] Location access denied", {
      mode,
      reason,
      path: req.path,
      locationId: locationId ? locationId.slice(-6) : null,
    });
    return mode === "report" ? { ok: true } : { ok: false, status, message };
  };

  const session = await verifyLocationSessionToken(
    getSessionTokenFromRequest(req)
  );
  if (!session) return deny(401, LOCATION_AUTH_REQUIRED_MSG, "no_session");

  const normalized = locationId?.trim();
  if (!normalized) return deny(403, LOCATION_FORBIDDEN_MSG, "no_location");

  if (session.activeLocation === normalized) return { ok: true };

  if (session.userType === "agency") {
    try {
      const installation = await getInstallation(normalized);
      if (
        installation?.companyId &&
        installation.companyId === session.companyId
      ) {
        return { ok: true };
      }
    } catch (error) {
      console.error("[Auth] Installation lookup failed during authorization", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return deny(403, LOCATION_FORBIDDEN_MSG, "location_mismatch");
}
