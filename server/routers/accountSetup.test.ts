import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ghl-service", () => ({
  updateExistingCustomValuesOnly: vi.fn(async () => ({
    missingKeys: [],
    failedKeys: [],
  })),
  ensureGhlCustomValue: vi.fn(),
  fetchAllCustomValues: vi.fn(async () => [
    { id: "CV_EIN", name: "business_ein", value: "12-3456789" },
    { id: "CV_BIZ", name: "Business", value: "Acme" },
  ]),
  findCustomValueId: vi.fn(
    (values: Array<Record<string, unknown>>, key: string) =>
      values.find(v => v.name === key)?.id as string | undefined
  ),
  saveGhlCustomValues: vi.fn(async () => ({
    missingKeys: [],
    failedKeys: [],
    createdKeys: ["business_ein"],
    updatedKeys: [],
    ids: { business_ein: "NEW" },
  })),
  resolveCustomValue: vi.fn(() => ""),
  uploadToGhlMedia: vi.fn(),
  getValidAccessToken: vi.fn(async () => "token"),
}));

vi.mock("../helpers/tokenHelper.js", () => ({
  getLocationAccessToken: vi.fn(async () => "token"),
}));

import {
  saveGhlCustomValues,
  updateExistingCustomValuesOnly,
} from "../ghl-service.js";
import { appRouter } from "../routers.js";

const caller = () =>
  appRouter.createCaller({
    user: null,
    req: {} as never,
    res: {} as never,
  } as never);

beforeEach(() => vi.clearAllMocks());

describe("accountSetup EIN (#25)", () => {
  it("saves the EIN to business_ein formatted as XX-XXXXXXX, exact match only", async () => {
    const res = await caller().accountSetup.saveField({
      locationId: "LOC_1",
      field: "businessEin",
      value: " 12 3456789 ",
    });
    expect(res.saved.value).toBe("12-3456789");
    expect(saveGhlCustomValues).toHaveBeenCalledWith(
      "LOC_1",
      { business_ein: "12-3456789" },
      { exactMatchOnly: true }
    );
    expect(updateExistingCustomValuesOnly).not.toHaveBeenCalled();
  });

  it("allows clearing the EIN", async () => {
    const res = await caller().accountSetup.saveField({
      locationId: "LOC_1",
      field: "businessEin",
      value: "",
    });
    expect(res.saved.value).toBe("");
  });

  it("rejects an EIN that is not 9 digits", async () => {
    await expect(
      caller().accountSetup.saveField({
        locationId: "LOC_1",
        field: "businessEin",
        value: "12-34567",
      })
    ).rejects.toThrow(/exactly 9 digits/);
    expect(saveGhlCustomValues).not.toHaveBeenCalled();
  });

  it("other fields keep the existing save path", async () => {
    await caller().accountSetup.saveField({
      locationId: "LOC_1",
      field: "businessAddress",
      value: "1 Main St",
    });
    expect(updateExistingCustomValuesOnly).toHaveBeenCalledWith("LOC_1", {
      business_address: "1 Main St",
    });
    expect(saveGhlCustomValues).not.toHaveBeenCalled();
  });

  it("loads the saved EIN", async () => {
    const settings = await caller().accountSetup.getSettings({
      locationId: "LOC_1",
    });
    expect(settings.businessEin).toBe("12-3456789");
  });
});
