import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Express } from "express";

// ── Mock ghl-service ─────────────────────────────────────────────────
vi.mock("../ghl-service", async importOriginal => {
  const actual = await importOriginal<typeof import("../ghl-service")>();
  return {
    ...actual,
    getValidAccessToken: vi.fn(async () => "mock_access_token"),
    getInstallation: vi.fn(async (locationId: string) => {
      if (locationId !== "LOC_1") return null;
      return {
        id: 1,
        locationId,
        accessToken: "mock_access_token",
        refreshToken: "mock_refresh_token",
        expiresAt: Date.now() + 3600_000,
      };
    }),
    getCustomFieldIdByName: (() => {
      // Self-referencing mock implementation defined inside the hoisted
      // factory so it can track prior calls (stale-cache retry scenario).
      const fn = vi.fn(async (locationId: string, fieldName: string) => {
        if (fieldName === "customer_status") return "FIELD_123";
        if (fieldName === "not_a_real_field") return null;
        // Simulate "cache miss then retry succeeds": the route clears the
        // cache for the location and calls us again, so the second call for
        // the same location/field name succeeds.
        const callHistory = (fn as any).mock.calls as Array<[string, string]>;
        // Exclude the current call itself.
        const priorSameFieldCalls = callHistory
          .slice(0, -1)
          .filter(([loc, f]) => loc === locationId && f === fieldName);
        if (priorSameFieldCalls.length === 0) return null;
        return "FIELD_456";
      });
      return fn;
    })(),
    clearCustomFieldCache: vi.fn(),
  };
});

// Must be set at module scope, before `./contactsCustomField` is imported,
// because the route module reads ENV.internalApiKey once when evaluated.
const INTERNAL_API_KEY = "test-internal-key";
process.env.INTERNAL_API_KEY = INTERNAL_API_KEY;

import { registerContactsCustomFieldRoutes } from "./contactsCustomField";

const BASE_URL = `http://127.0.0.1`;

let app: Express;
let server: Awaited<ReturnType<Express["listen"]>>;
let port: number;

beforeAll(async () => {
  app = express();
  // Mirror createApp(): capture raw body via express.json's verify option
  // express.json() is broken under vitest (route stack never dispatches after it runs);
  // use an equivalent manual parser that also captures the raw body (like prod createApp).
  app.use((req, res, next) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      (req as any).rawBody = raw;
      let parsed: unknown = undefined;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        (req as any).invalid_json = true;
      }
      (req as any).body = parsed;
      next();
    });
    req.on("error", next);
  });
  registerContactsCustomFieldRoutes(app);
  server = await new Promise<
    Express["listen"] extends (cb?: () => void) => infer S ? S : any
  >(resolve => {
    const s = app.listen(0, () => resolve(s as any));
  });
  port = (server.address() as any).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function basicRequest(body: object | null, opts: { key?: string } = {}) {
  const res = await fetch(
    `${BASE_URL}:${port}/api/contacts/update-custom-field`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Internal-Key ${opts.key ?? INTERNAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── Auth tests ─────────────────────────────────────────────────────────

describe("POST /api/contacts/update-custom-field — authentication", () => {
  it("rejects requests without the internal key", async () => {
    const res = await basicRequest(
      {
        locationId: "LOC_1",
        email: "joe@example.com",
        customFieldName: "customer_status",
        value: "Active",
      },
      { key: "wrong-key" }
    );
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("UNAUTHORIZED");
  });
});

// ── Validation tests ───────────────────────────────────────────────────

describe("POST /api/contacts/update-custom-field — validation", () => {
  it("rejects an invalid JSON body", async () => {
    const rawBody = "{not json}";
    const res = await fetch(
      `${BASE_URL}:${port}/api/contacts/update-custom-field`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Internal-Key ${INTERNAL_API_KEY}`,
        },
        body: rawBody,
      }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects a missing locationId", async () => {
    const res = await basicRequest({
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("INVALID_PAYLOAD");
    expect(res.body?.details?.some((d: any) => d.field === "locationId")).toBe(
      true
    );
  });

  it("rejects a missing email", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(400);
    expect(res.body?.details?.some((d: any) => d.field === "email")).toBe(true);
  });

  it("rejects an invalid email format", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      email: "not-an-email",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(400);
    expect(res.body?.details?.some((d: any) => d.field === "email")).toBe(true);
  });

  it("rejects a missing customFieldName", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      value: "Active",
    });
    expect(res.status).toBe(400);
    expect(
      res.body?.details?.some((d: any) => d.field === "customFieldName")
    ).toBe(true);
  });

  it("rejects an empty value", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "",
    });
    expect(res.status).toBe(400);
    expect(res.body?.details?.some((d: any) => d.field === "value")).toBe(true);
  });
});

// ── Operation tests ────────────────────────────────────────────────────

// Track calls made to the GHL API so tests can assert on the search/update flow.
const ghlCalls: Array<{ url: string; init: any }> = [];
const realFetch = globalThis.fetch;

const fetchMock = vi.fn(async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : (input?.url ?? ""));
  ghlCalls.push({ url, init });
  if (url.includes("services.leadconnectorhq.com/contacts/search")) {
    return new Response(
      JSON.stringify({
        contacts: [
          {
            id: "CONTACT_42",
            email: "joe@example.com",
            firstName: "Joe",
            lastName: "Doe",
            customFields: [
              { fieldKey: "customer_status", field_value: "Inactive" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (/services\.leadconnectorhq\.com\/contacts\/CONTACT_42/.test(url)) {
    return new Response(JSON.stringify({ contact: { id: "CONTACT_42" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Fall back to the real fetch for anything that is not a mocked endpoint
  return realFetch(input, init);
});

vi.stubGlobal("fetch", fetchMock);

describe("POST /api/contacts/update-custom-field — happy path", () => {
  it("updates a contact's custom field by name and returns field/contact IDs", async () => {
    ghlCalls.length = 0;
    const res = await basicRequest({
      locationId: "LOC_1",
      contactName: "Joe Doe",
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.contactId).toBe("CONTACT_42");
    expect(res.body?.customFieldId).toBe("FIELD_123");
    expect(res.body?.updatedValue).toBe("Active");
    expect(res.body?.previousValue).toBe("Inactive");
    expect(res.body?.email).toBe("joe@example.com");
    expect(res.body?.locationId).toBe("LOC_1");

    // Flow: contacts/search first, then PUT /contacts/{id}.
    // ghlCalls[0] is the test client's own POST to the local endpoint, so the
    // GHL calls start at index 1.
    expect(ghlCalls[1].url).toContain("/contacts/search");
    expect(ghlCalls[1].init?.method).toBe("POST");
    const searchBody = JSON.parse(ghlCalls[1].init?.body);
    expect(searchBody.locationId).toBe("LOC_1");
    expect(searchBody.filters?.[0]).toEqual({
      field: "email",
      operator: "eq",
      value: "joe@example.com",
    });

    expect(ghlCalls[2].url).toContain("/contacts/CONTACT_42");
    expect(ghlCalls[2].init?.method).toBe("PUT");
    const putBody = JSON.parse(ghlCalls[2].init?.body);
    expect(putBody.customFields).toEqual([
      { key: "FIELD_123", field_value: "Active" },
    ]);

    // Both GHL requests must carry the per-location bearer token and GHL API version
    for (const call of [ghlCalls[1], ghlCalls[2]]) {
      expect(call.init.headers?.Authorization).toBe("Bearer mock_access_token");
      expect(call.init.headers?.Version).toBe("2021-07-28");
    }
  });

  it("clears the field cache and retries when the field is not found on first lookup", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      customFieldName: "some_new_field",
      value: "Value",
    });
    expect(res.status).toBe(200);
    expect(res.body?.customFieldId).toBe("FIELD_456");
    expect(
      vi.mocked(await import("../ghl-service")).clearCustomFieldCache
    ).toHaveBeenCalledWith("LOC_1");
  });
});

describe("POST /api/contacts/update-custom-field — error paths", () => {
  it("returns 404 when the location is not installed", async () => {
    const res = await basicRequest({
      locationId: "BAD_LOCATION",
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe("LOCATION_NOT_FOUND");
    expect(res.body?.locationId).toBe("BAD_LOCATION");
  });

  it("returns 404 when no contact matches the email", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: any, init?: any) => {
      const url = String(
        typeof input === "string" ? input : (input?.url ?? "")
      );
      if (url.includes("/contacts/search")) {
        return new Response(JSON.stringify({ contacts: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    });

    const res = await basicRequest({
      locationId: "LOC_1",
      email: "missing@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe("CONTACT_NOT_FOUND");
    expect(res.body?.email).toBe("missing@example.com");

    fetchSpy.mockRestore();
  });

  it("returns 404 when the custom field does not exist", async () => {
    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      customFieldName: "not_a_real_field",
      value: "Active",
    });
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe("CUSTOM_FIELD_NOT_FOUND");
    expect(res.body?.customFieldName).toBe("not_a_real_field");
  });

  it("returns 422 when the GHL update call fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: any, init?: any) => {
      const url = String(
        typeof input === "string" ? input : (input?.url ?? "")
      );
      if (url.includes("/contacts/search")) {
        return new Response(
          JSON.stringify({
            contacts: [{ id: "CONTACT_42", email: "joe@example.com" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/contacts/CONTACT_42") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            error: { code: "VALIDATION_ERROR", message: "Field locked" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return realFetch(input, init);
    });

    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("CUSTOM_FIELD_UPDATE_FAILED");

    fetchSpy.mockRestore();
  });

  it("returns 422 when the GHL contact search fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: any, init?: any) => {
      const url = String(
        typeof input === "string" ? input : (input?.url ?? "")
      );
      if (url.includes("/contacts/search")) {
        return new Response(
          JSON.stringify({ error: { message: "server boom" } }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return realFetch(input, init);
    });

    const res = await basicRequest({
      locationId: "LOC_1",
      email: "joe@example.com",
      customFieldName: "customer_status",
      value: "Active",
    });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("CONTACT_SEARCH_FAILED");

    fetchSpy.mockRestore();
  });
});
