import { afterEach, describe, expect, it, vi } from "vitest";
import { gdeltModeFromEnvironment, shouldEnableGdelt } from "@/lib/news/providers";

afterEach(() => vi.unstubAllEnvs());

describe("archive provider configuration", () => {
  it("enables GDELT automatically only for historical country discovery", () => {
    vi.stubEnv("GDELT_MODE", "auto");
    expect(shouldEnableGdelt({ period: "30d", countries: ["US"] })).toBe(true);
    expect(shouldEnableGdelt({ period: "7d", countries: ["DE"] })).toBe(true);
    expect(shouldEnableGdelt({ period: "latest", countries: ["US"] })).toBe(false);
    expect(shouldEnableGdelt({ period: "30d", countries: [] })).toBe(false);
  });

  it("retains the legacy switch while giving the explicit mode precedence", () => {
    vi.stubEnv("GDELT_MODE", "");
    vi.stubEnv("GDELT_ENABLED", "true");
    expect(gdeltModeFromEnvironment()).toBe("on");
    vi.stubEnv("GDELT_MODE", "off");
    expect(gdeltModeFromEnvironment()).toBe("off");
    expect(shouldEnableGdelt({ period: "30d", countries: ["US"] })).toBe(false);
  });
});
