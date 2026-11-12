import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ghl-service", () => ({
  getLocationCustomValueMap: vi.fn(),
  saveGhlCustomValues: vi.fn(),
  describeUnsavedCustomValues: vi.fn(() => ""),
  uploadToGhlMedia: vi.fn(),
}));

import { getLocationCustomValueMap, saveGhlCustomValues } from "./ghl-service.js";
import { appRouter } from "./routers.js";
import { toAbsoluteAssetUrl } from "../client/src/lib/assetUrl.js";

const mockedGetMap = vi.mocked(getLocationCustomValueMap);
const mockedSave = vi.mocked(saveGhlCustomValues);

function caller() {
  return appRouter.createCaller({
    user: null,
    req: {} as never,
    res: {} as never,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSave.mockResolvedValue({
    missingKeys: [],
    failedKeys: [],
    createdKeys: [],
    updatedKeys: [],
    ids: {},
  } as never);
});

describe("reactivation custom quote", () => {
  it("loads gallery image 6 back so the next save keeps it", async () => {
    mockedGetMap.mockResolvedValue(
      new Map([
        ["image_5", { id: "5", value: "https://cdn.example.com/five.jpg" }],
        ["image_6", { id: "6", value: "https://cdn.example.com/six.jpg" }],
      ]) as never
    );
    const settings = await caller().reactivation.getSettings({ locationId: "loc1" });
    expect(settings.customQuote.image5).toBe("https://cdn.example.com/five.jpg");
    expect(settings.customQuote.image6).toBe("https://cdn.example.com/six.jpg");
  });

  it("saves gallery image 6 to the image_6 custom value", async () => {
    await caller().reactivation.saveCustomValuesSettings({
      locationId: "loc1",
      reactivationOption: "Custom Quote & Link",
      onetimeTiming: "Never",
      customQuoteData: {
        businessLogo: "https://cdn.example.com/logo.png",
        image6: "https://homeflow-suite.vercel.app/dog-photo.webp",
        sendQuoteAutomatically: true,
        showCardSection: true,
      },
    });
    const updates = mockedSave.mock.calls[0][1] as Record<string, string>;
    expect(updates.image_6).toBe("https://homeflow-suite.vercel.app/dog-photo.webp");
    expect(updates.reactivation_options).toBe("Custom-Link");
  });
});

describe("toAbsoluteAssetUrl", () => {
  const origin = "https://homeflow-suite.vercel.app";

  it("turns a placeholder path into a full URL on the app's origin", () => {
    expect(toAbsoluteAssetUrl("/dog-photo.webp", origin)).toBe(
      "https://homeflow-suite.vercel.app/dog-photo.webp"
    );
  });

  it("leaves hosted URLs, uploads and empty values alone", () => {
    expect(toAbsoluteAssetUrl("https://cdn.example.com/a.png", origin)).toBe(
      "https://cdn.example.com/a.png"
    );
    expect(toAbsoluteAssetUrl("data:image/png;base64,AAAA", origin)).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(toAbsoluteAssetUrl("//cdn.example.com/a.png", origin)).toBe(
      "//cdn.example.com/a.png"
    );
    expect(toAbsoluteAssetUrl("", origin)).toBeUndefined();
    expect(toAbsoluteAssetUrl(null, origin)).toBeUndefined();
  });
});
