import { describe, expect, it } from "vitest";
import { updateCountrySelection } from "@/components/map/selection";

describe("country selection", () => {
  it("selects one country", () => {
    expect(updateCountrySelection([], "JP")).toEqual(["JP"]);
  });

  it("selects a second country", () => {
    expect(updateCountrySelection(["JP"], "SG")).toEqual(["JP", "SG"]);
  });

  it("deselects an already selected country", () => {
    expect(updateCountrySelection(["JP", "SG"], "JP")).toEqual(["SG"]);
  });

  it("never exceeds two countries and replaces the oldest selection", () => {
    expect(updateCountrySelection(["JP", "SG"], "US")).toEqual(["SG", "US"]);
  });
});
