import { describe, expect, it } from "vitest";
import { pwaUpdateWorkboxConfig } from "./pwaConfig";

describe("PWA update configuration", () => {
  it("claims open clients after the user accepts a waiting update", () => {
    expect(pwaUpdateWorkboxConfig.clientsClaim).toBe(true);
  });

  it("keeps activation behind the explicit refresh prompt", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        pwaUpdateWorkboxConfig,
        "skipWaiting",
      ),
    ).toBe(false);
  });
});
