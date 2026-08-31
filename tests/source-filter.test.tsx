import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SourceFilter } from "@/components/filters/SourceFilter";
import type { SourceFacet } from "@/lib/news/types";

const sources: SourceFacet[] = [
  { id: "nhk", name: "NHK", domain: "nhk.or.jp", countryCode: "JP", region: "Asia", language: "ja", scope: "NATIONAL", qualityScore: 0.88, storyCount: 8 },
  { id: "japan-times", name: "The Japan Times", domain: "japantimes.co.jp", countryCode: "JP", region: "Asia", language: "en", scope: "NATIONAL", qualityScore: 0.84, storyCount: 6 },
  { id: "reuters", name: "Reuters", domain: "reuters.com", countryCode: "GB", region: null, language: "en", scope: "INTERNATIONAL", qualityScore: 0.92, storyCount: 12 },
];

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  return <SourceFilter availableSources={sources} selectedCountries={["JP"]} value={value} onChange={setValue} />;
}

const manySources: SourceFacet[] = Array.from({ length: 21 }, (_, index) => ({
  id: `publisher-${index + 1}`,
  name: `Publisher ${index + 1}`,
  domain: `publisher-${index + 1}.example`,
  countryCode: index % 2 === 0 ? "JP" : "GB",
  region: null,
  language: "en",
  scope: "INTERNATIONAL" as const,
  qualityScore: 0.7,
  storyCount: index + 1,
}));

function LimitHarness() {
  const [value, setValue] = useState<string[]>(manySources.slice(0, 20).map(({ id }) => id));
  return <SourceFilter availableSources={manySources} selectedCountries={[]} value={value} onChange={setValue} />;
}

describe("source picker", () => {
  it("searches, groups, multi-selects by stable ID, and keeps selections visible", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /news outlets/i }));

    expect(screen.getByRole("heading", { name: "Local publishers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "International publishers" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /NHK/i }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const selectedGroup = screen.getByRole("heading", { name: "Selected" }).closest("section");
    expect(within(selectedGroup!).getByText("NHK")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search news outlets" }), "Reuters");
    expect(screen.getByText("Reuters")).toBeInTheDocument();
    expect(screen.getByText("NHK")).toBeInTheDocument();
    expect(screen.queryByText("The Japan Times")).not.toBeInTheDocument();
  });

  it("accepts 20 outlets, blocks a 21st, and keeps removal and Clear available", async () => {
    const user = userEvent.setup();
    render(<LimitHarness />);
    await user.click(screen.getByRole("button", { name: /news outlets/i }));

    expect(screen.getByText("Maximum 20 outlets")).toBeInTheDocument();
    const twentyFirst = screen.getByRole("checkbox", { name: /Publisher 21/i });
    expect(twentyFirst).toBeDisabled();

    const firstSelected = screen.getAllByRole("checkbox").find(
      (checkbox) => (checkbox as HTMLInputElement).checked,
    );
    expect(firstSelected).toBeDefined();
    await user.click(firstSelected!);
    expect(twentyFirst).toBeEnabled();
    await user.click(twentyFirst);
    expect(screen.getByText("20 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("All outlets")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Publisher 21/i })).toBeEnabled();
  });
});
