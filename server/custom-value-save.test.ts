import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stored, non-expired installation for LOC_1 so getValidAccessToken works
// without a real database.
vi.mock("./db.js", () => {
  const row = {
    id: 1,
    locationId: "LOC_1",
    companyId: "COMP_1",
    accessToken: "token_1",
    refreshToken: "refresh_1",
    expiresAt: Date.now() + 3_600_000,
  };
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [row],
  };
  return { getDb: async () => chain };
});

import { saveGhlCustomValues } from "./ghl-service.js";

type Call = { method: string; url: string; body?: any; version?: string };

let customValues: Array<Record<string, unknown>> = [];
let calls: Call[] = [];
let handler: (call: Call) => Response | undefined;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: any = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        url: String(input),
        body: init.body ? JSON.parse(init.body) : undefined,
        version: init.headers?.Version,
      };
      calls.push(call);
      const custom = handler(call);
      if (custom) return custom;
      if (call.method === "GET" && call.url.endsWith("/customValues")) {
        return json({ customValues });
      }
      if (call.method === "PUT") return json({ customValue: {} });
      if (call.method === "POST") {
        return json({ customValue: { id: `NEW_${call.body.name}` } });
      }
      return json({}, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const writes = () => calls.filter(c => c.method !== "GET");

describe("saveGhlCustomValues", () => {
  it("updates existing values by ID and keeps their display name", async () => {
    customValues = [
      {
        id: "CV_TITLE",
        name: "Quote Title",
        fieldKey: "{{ custom_values.quote_title }}",
        value: "old",
      },
    ];
    const result = await saveGhlCustomValues("LOC_1", { quote_title: "New" });

    expect(result).toMatchObject({
      updatedKeys: ["quote_title"],
      createdKeys: [],
      missingKeys: [],
      failedKeys: [],
    });
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "PUT",
        url: expect.stringContaining("/customValues/CV_TITLE"),
        body: { name: "Quote Title", value: "New" },
      }),
    ]);
  });

  it("creates values that do not exist in the sub-account", async () => {
    customValues = [];
    const result = await saveGhlCustomValues("LOC_1", { tos_link: "https://x" });

    expect(result.createdKeys).toEqual(["tos_link"]);
    expect(result.ids.tos_link).toBe("NEW_tos_link");
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        version: "v3",
        body: { name: "tos_link", value: "https://x" },
      }),
    ]);
  });

  it("never lets a fuzzy match overwrite a value another key owns", async () => {
    // review_1 is missing; review_1_name exists. The old code fuzzy-matched
    // review_1 onto review_1_name and silently dropped one of the two values.
    customValues = [
      { id: "CV_NAME", name: "review_1_name", value: "" },
    ];
    const result = await saveGhlCustomValues("LOC_1", {
      review_1: "Great service",
      review_1_name: "Ann",
    });

    expect(result.updatedKeys).toEqual(["review_1_name"]);
    expect(result.createdKeys).toEqual(["review_1"]);
    const put = writes().find(c => c.method === "PUT");
    expect(put?.body).toEqual({ name: "review_1_name", value: "Ann" });
    const post = writes().find(c => c.method === "POST");
    expect(post?.body).toEqual({ name: "review_1", value: "Great service" });
  });

  it("still matches HomeFlow snapshot display names (no duplicate created)", async () => {
    customValues = [
      {
        id: "CV_LEAD",
        name: "Lead Follow-up Options (Lite, SG-Link, Custom-Link)",
        value: "Lite",
      },
    ];
    const result = await saveGhlCustomValues("LOC_1", {
      lead_followup_options: "SG-Link",
    });
    expect(result.updatedKeys).toEqual(["lead_followup_options"]);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].url).toContain("/customValues/CV_LEAD");
  });

  it("does not create or report optional alias keys", async () => {
    customValues = [
      { id: "CV_SG", name: "sg_authorization_key_access_token", value: "" },
    ];
    const result = await saveGhlCustomValues(
      "LOC_1",
      { sg_authorization_key_access_token: "abc", access_token: "abc" },
      { optionalKeys: ["access_token"] }
    );
    expect(result.updatedKeys).toEqual(["sg_authorization_key_access_token"]);
    expect(result.missingKeys).toEqual([]);
    expect(writes().filter(c => c.method === "POST")).toHaveLength(0);
  });

  it("reports missing keys instead of creating them when creation is disabled", async () => {
    customValues = [];
    const result = await saveGhlCustomValues(
      "LOC_1",
      { quote_title: "x" },
      { createMissing: false }
    );
    expect(result.missingKeys).toEqual(["quote_title"]);
    expect(writes()).toHaveLength(0);
  });

  it("throws (and writes nothing) when the custom-value list cannot be read", async () => {
    handler = call =>
      call.method === "GET" ? json({ message: "Unauthorized" }, 401) : undefined;
    await expect(
      saveGhlCustomValues("LOC_1", { quote_title: "x" })
    ).rejects.toThrow(/could not be loaded \(401\)/);
    expect(writes()).toHaveLength(0);
  });

  it("retries a rate-limited PUT and reports success", async () => {
    customValues = [{ id: "CV_A", name: "tos_link", value: "" }];
    let attempts = 0;
    handler = call => {
      if (call.method !== "PUT") return undefined;
      attempts += 1;
      return attempts === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : undefined;
    };
    const result = await saveGhlCustomValues("LOC_1", { tos_link: "y" });
    expect(attempts).toBe(2);
    expect(result.updatedKeys).toEqual(["tos_link"]);
    expect(result.failedKeys).toEqual([]);
  });

  it("reports a PUT that GHL rejects as failed", async () => {
    customValues = [{ id: "CV_A", name: "tos_link", value: "" }];
    handler = call =>
      call.method === "PUT" ? json({ message: "bad" }, 422) : undefined;
    const result = await saveGhlCustomValues("LOC_1", { tos_link: "y" });
    expect(result.failedKeys).toEqual(["tos_link"]);
    expect(result.updatedKeys).toEqual([]);
  });

  it("updates instead of failing when GHL says the value already exists", async () => {
    customValues = [];
    handler = call => {
      if (call.method === "POST") {
        // Someone created it in the meantime.
        customValues = [{ id: "CV_RACE", name: "tos_link", value: "" }];
        return json({ message: "Custom value already exists" }, 400);
      }
      return undefined;
    };
    const result = await saveGhlCustomValues("LOC_1", { tos_link: "z" });
    expect(result.updatedKeys).toEqual(["tos_link"]);
    expect(result.ids.tos_link).toBe("CV_RACE");
  });

  it("exactMatchOnly creates a new key instead of using a similarly named value", async () => {
    // Without exactMatchOnly, "business_ein" would fuzzy-match "Business".
    customValues = [{ id: "CV_BIZ", name: "Business", value: "Acme" }];
    const result = await saveGhlCustomValues(
      "LOC_1",
      { business_ein: "12-3456789" },
      { exactMatchOnly: true }
    );
    expect(result.createdKeys).toEqual(["business_ein"]);
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        body: { name: "business_ein", value: "12-3456789" },
      }),
    ]);
  });
});
