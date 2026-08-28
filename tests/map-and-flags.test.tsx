import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountryFlag } from "@/components/CountryFlag";
import { WorldMap } from "@/components/map/WorldMap";

afterEach(cleanup);

describe("country visuals", () => {
  it("renders a real local flag asset class instead of an emoji code", () => {
    const { container } = render(<CountryFlag code="SG" />);
    expect(container.querySelector(".country-flag.fi.fi-sg")).toBeInTheDocument();
  });

  it("loads Singapore as selectable high-resolution country geometry after zooming", async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <WorldMap selectedCountries={[]} selectionLimit={1} onSelectionChange={onSelectionChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Singapore" }));
    expect(onSelectionChange).toHaveBeenCalledWith(["SG"]);
    expect(container.querySelector(".small-country-dot")).not.toBeInTheDocument();
  });
});
