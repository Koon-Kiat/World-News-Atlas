import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldMap } from "@/components/map/WorldMap";
import { CountryPicker } from "@/components/map/CountryPicker";
import { FilterSelect } from "@/components/filters/FilterSelect";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("accessible map and selectors", () => {
  it("has one country Tab stop, roves predictably, and selects with Enter and Space", () => {
    function Map() {
      const [selected, setSelected] = useState<string[]>([]);
      return <WorldMap selectedCountries={selected} selectionLimit={1} onSelectionChange={setSelected} />;
    }
    const { container } = render(<Map />);
    const paths = [...container.querySelectorAll<SVGPathElement>(".map-country")];
    expect(paths.filter((path) => path.getAttribute("tabindex") === "0")).toHaveLength(1);
    act(() => paths[0].focus());
    fireEvent.keyDown(paths[0], { key: "ArrowDown" });
    expect(paths[1]).toHaveFocus();
    fireEvent.keyDown(paths[1], { key: "Enter" });
    expect(paths[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(paths[1], { key: " " });
    expect(paths[1]).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(paths[1], { key: "End" });
    expect(paths.at(-1)).toHaveFocus();
    fireEvent.keyDown(paths.at(-1)!, { key: "Home" });
    expect(paths[0]).toHaveFocus();
    expect(paths.filter((path) => path.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("lets ordinary wheel scrolling pass and keeps zoom/reset controls and geometry stable", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { frame = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(<WorldMap selectedCountries={[]} selectionLimit={1} onSelectionChange={() => {}} />);
    const svg = screen.getByRole("group", { name: /Interactive world map/ });
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 500 } as DOMRect);
    const paths = [...container.querySelectorAll(".map-country")];
    const geometry = paths.map((path) => path.getAttribute("d"));
    const scroll = new WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true });
    fireEvent(svg, scroll);
    expect(scroll.defaultPrevented).toBe(false);
    const atLimit = new WheelEvent("wheel", { deltaY: 80, ctrlKey: true, cancelable: true });
    fireEvent(svg, atLimit);
    expect(atLimit.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    act(() => frame?.(1));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    const zoom = new WheelEvent("wheel", { deltaY: -10, ctrlKey: true, cancelable: true });
    fireEvent(svg, zoom); act(() => frame?.(2));
    expect(zoom.defaultPrevented).toBe(true);
    expect([...container.querySelectorAll(".map-country")]).toEqual(paths);
    expect(paths.map((path) => path.getAttribute("d"))).toEqual(geometry);
    fireEvent.click(screen.getByRole("button", { name: "Reset map zoom" })); act(() => frame?.(3));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });

  it("announces active country suggestions and never silently selects an unannounced result", () => {
    const onSelect = vi.fn();
    render(<CountryPicker selectedCountries={[]} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "united" } });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" }); expect(onSelect).not.toHaveBeenCalled();
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" }); expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "SG" } });
    fireEvent.keyDown(input, { key: "ArrowDown" }); fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false"); expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" }); expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports select navigation, commit, cancel and predictable focus", () => {
    function Select() {
      const [value, setValue] = useState("a");
      return <FilterSelect label="Sort" value={value} onChange={setValue} options={[{ value: "a", label: "Newest" }, { value: "b", label: "Popular" }]} />;
    }
    render(<Select />);
    const control = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.keyDown(control, { key: " " }); fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(control).toHaveTextContent("Popular"); expect(control).toHaveFocus();
    fireEvent.keyDown(control, { key: "ArrowUp" }); fireEvent.keyDown(control, { key: "ArrowUp" });
    expect(control).toHaveAttribute("aria-activedescendant", within(screen.getByRole("listbox")).getAllByRole("option")[0].id);
    fireEvent.keyDown(control, { key: "Escape" });
    expect(control).toHaveTextContent("Popular"); expect(control).toHaveAttribute("aria-expanded", "false");
  });
});
