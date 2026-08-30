import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountryFlag } from "@/components/CountryFlag";
import { CountryPicker } from "@/components/map/CountryPicker";
import { WorldMap } from "@/components/map/WorldMap";

afterEach(cleanup);

describe("country visuals", () => {
  it("renders a real local flag asset class instead of an emoji code", () => {
    const { container } = render(<CountryFlag code="SG" />);
    expect(container.querySelector(".country-flag.fi.fi-sg")).toBeInTheDocument();
  });

  it("includes Singapore as selectable high-resolution country geometry", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <WorldMap selectedCountries={[]} selectionLimit={1} onSelectionChange={onSelectionChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Singapore" }));
    expect(onSelectionChange).toHaveBeenCalledWith(["SG"]);
    expect(container.querySelector(".small-country-dot")).not.toBeInTheDocument();
  });

  it("recognizes common country aliases such as US", () => {
    const onSelect = vi.fn();
    render(<CountryPicker selectedCountries={[]} onSelect={onSelect} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Choose a country/i }), { target: { value: "US" } });
    const firstMatch = screen.getAllByRole("option")[0];
    expect(firstMatch).toHaveTextContent("United States of America");
    expect(firstMatch).toHaveTextContent("US");
    fireEvent.click(firstMatch);

    expect(onSelect).toHaveBeenCalledWith("US");
  });
});
