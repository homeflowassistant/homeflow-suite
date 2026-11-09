/**
 * HomeFlow session from HighLevel SSO.
 *
 * When the server has GHL_APP_SSO_KEY configured, the app (running inside the
 * HighLevel sidebar iframe) asks the parent window for the encrypted user
 * payload, exchanges it at /api/auth/ghl-sso for a session token, and sends
 * that token as the `x-homeflow-session` header on every API request.
 * When SSO is not configured, no header is sent and nothing changes.
 */

export const SESSION_HEADER = "x-homeflow-session";
const STORAGE_KEY = "homeflow.session.v1";
const SSO_TIMEOUT_MS = 6000;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

type StoredSession = { token: string; expiresAt: number };

let sessionPromise: Promise<string | null> | null = null;
// Set once the server reports SSO is not configured: never ask again.
let ssoDisabled = false;

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || "";
}

// In-memory copy: sessionStorage is often blocked for third-party iframes.
let memorySession: StoredSession | null = null;

function isFresh(session: StoredSession | null): session is StoredSession {
  return !!session && session.expiresAt - EXPIRY_MARGIN_MS > Date.now();
}

function readStored(): StoredSession | null {
  if (isFresh(memorySession)) return memorySession;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      typeof parsed?.token === "string" &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt - EXPIRY_MARGIN_MS > Date.now()
    ) {
      return parsed;
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

function writeStored(session: StoredSession | null) {
  memorySession = session;
  try {
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

function requestEncryptedUserData(): Promise<string | null> {
  if (typeof window === "undefined" || window.parent === window) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, SSO_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      const data = event.data as { message?: unknown; payload?: unknown };
      if (data?.message !== "REQUEST_USER_DATA_RESPONSE") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(typeof data.payload === "string" ? data.payload : null);
    }

    window.addEventListener("message", onMessage);
    // The payload is encrypted with the app's shared secret, so it is safe
    // to accept from any parent origin (HighLevel supports white-label
    // domains); the server rejects anything it cannot decrypt.
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
  });
}

async function createSession(): Promise<string | null> {
  const stored = readStored();
  if (stored) return stored.token;

  const base = getApiBaseUrl();
  try {
    const config = await fetch(`${base}/api/auth/config`).then(r =>
      r.ok ? (r.json() as Promise<{ ssoEnabled?: boolean }>) : null
    );
    if (config && !config.ssoEnabled) {
      ssoDisabled = true;
      return null;
    }
    if (!config) return null;
  } catch {
    return null;
  }

  const payload = await requestEncryptedUserData();
  if (!payload) {
    console.warn(
      "[HomeFlow] Could not obtain HighLevel user data. Open HomeFlow from the HighLevel sidebar."
    );
    return null;
  }

  const response = await fetch(`${base}/api/auth/ghl-sso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (!response.ok) {
    console.warn("[HomeFlow] HighLevel SSO exchange failed", response.status);
    return null;
  }
  const data = (await response.json()) as StoredSession;
  if (!data?.token) return null;
  writeStored({ token: data.token, expiresAt: data.expiresAt });
  return data.token;
}

/** Resolves to the session token, or null when SSO is not in use. */
export function getSessionToken(): Promise<string | null> {
  if (ssoDisabled) return Promise.resolve(null);
  const stored = typeof window !== "undefined" ? readStored() : null;
  if (stored) return Promise.resolve(stored.token);
  if (!sessionPromise) {
    sessionPromise = createSession().then(token => {
      // Keep a successful result cached via storage; allow a fresh attempt
      // after a failure or once the token expires.
      sessionPromise = null;
      return token;
    });
  }
  return sessionPromise;
}

export function clearSession() {
  writeStored(null);
  sessionPromise = null;
}

export async function getSessionHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { [SESSION_HEADER]: token } : {};
}

/** fetch() that adds the HomeFlow session header. */
export async function apiFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const sessionHeaders = await getSessionHeaders();
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(sessionHeaders)) {
    headers.set(key, value);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && sessionHeaders[SESSION_HEADER]) {
    clearSession();
  }
  return response;
}
