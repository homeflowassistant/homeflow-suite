import { createCipheriv, createHash, randomBytes } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const SSO_KEY = "test-sso-shared-secret";

vi.mock("../ghl-service.js", () => ({
  getInstallation: vi.fn(async (locationId: string) =>
    locationId === "AGENCY_LOC" ? { locationId, companyId: "COMP_1" } : undefined
  ),
}));

/** Same format as CryptoJS.AES.encrypt(text, passphrase) / openssl enc -md md5. */
function cryptoJsEncrypt(text: string, passphrase: string): string {
  const salt = randomBytes(8);
  const parts: Buffer[] = [];
  let prev: Buffer = Buffer.alloc(0);
  while (Buffer.concat(parts).length < 48) {
    prev = createHash("md5")
      .update(Buffer.concat([prev, Buffer.from(passphrase), salt]))
      .digest();
    parts.push(prev);
  }
  const derived = Buffer.concat(parts);
  const cipher = createCipheriv(
    "aes-256-cbc",
    derived.subarray(0, 32),
    derived.subarray(32, 48)
  );
  return Buffer.concat([
    Buffer.from("Salted__"),
    salt,
    cipher.update(text, "utf8"),
    cipher.final(),
  ]).toString("base64");
}

let sso: typeof import("./ghlSso.js");

beforeAll(async () => {
  process.env.GHL_APP_SSO_KEY = SSO_KEY;
  process.env.JWT_SECRET = "jwt-secret-for-tests";
  delete process.env.HOMEFLOW_AUTH_MODE;
  vi.resetModules();
  sso = await import("./ghlSso.js");
});

function req(token?: string) {
  return {
    path: "/api/trpc/x",
    headers: token ? { "x-homeflow-session": token } : {},
  } as never;
}

async function tokenFor(user: Record<string, unknown>) {
  const decoded = sso.decodeGhlSsoPayload(
    cryptoJsEncrypt(JSON.stringify(user), SSO_KEY)
  );
  return (await sso.createLocationSessionToken(decoded)).token;
}

describe("HighLevel SSO", () => {
  it("decrypts a CryptoJS-encrypted payload", () => {
    const user = sso.decodeGhlSsoPayload(
      cryptoJsEncrypt(
        JSON.stringify({
          userId: "U1",
          companyId: "COMP_1",
          activeLocation: "LOC_1",
          type: "location",
          role: "admin",
        }),
        SSO_KEY
      )
    );
    expect(user).toMatchObject({
      userId: "U1",
      companyId: "COMP_1",
      activeLocation: "LOC_1",
      userType: "location",
    });
  });

  it("rejects payloads encrypted with a different secret", () => {
    expect(() =>
      sso.decodeGhlSsoPayload(
        cryptoJsEncrypt(JSON.stringify({ userId: "U1", companyId: "C" }), "wrong")
      )
    ).toThrow();
  });

  it("enforces access once the SSO key is configured", async () => {
    expect(sso.getAuthMode()).toBe("enforce");
    const token = await tokenFor({
      userId: "U1",
      companyId: "COMP_1",
      activeLocation: "LOC_1",
      type: "location",
    });

    expect(await sso.checkLocationAccess(req(token), "LOC_1")).toEqual({ ok: true });
    expect(await sso.checkLocationAccess(req(token), "OTHER_LOC")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await sso.checkLocationAccess(req(), "LOC_1")).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      await sso.checkLocationAccess(req("forged.token.value"), "LOC_1")
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("lets agency users act on locations installed under their company only", async () => {
    const token = await tokenFor({
      userId: "U2",
      companyId: "COMP_1",
      type: "agency",
    });
    expect(await sso.checkLocationAccess(req(token), "AGENCY_LOC")).toEqual({
      ok: true,
    });
    expect(await sso.checkLocationAccess(req(token), "LOC_X")).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
