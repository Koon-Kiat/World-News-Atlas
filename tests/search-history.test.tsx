import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderSearch } from "@/components/HeaderSearch";

function SearchHarness({ onSearch }: { onSearch: () => void }) {
  const [value, setValue] = useState("");
  return <HeaderSearch value={value} onChange={setValue} onSearch={onSearch} />;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("header search history", () => {
  it("still searches and clears in-memory history when browser storage rejects writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const onSearch = vi.fn();
    render(<SearchHarness onSearch={onSearch} />);
    const input = screen.getByRole("searchbox", { name: "Search news" });
    fireEvent.change(input, { target: { value: "Sendai" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSearch).toHaveBeenCalledOnce();
    fireEvent.focus(input);
    expect(screen.getByRole("button", { name: "Sendai" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(screen.queryByRole("button", { name: "Sendai" })).not.toBeInTheDocument();
  });
  it("stores submitted searches, reuses them, and clears the list", () => {
    const onSearch = vi.fn();
    render(<SearchHarness onSearch={onSearch} />);
    const input = screen.getByRole("searchbox", { name: "Search news" });

    fireEvent.change(input, { target: { value: "Sendai" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSearch).toHaveBeenCalledTimes(1);

    fireEvent.focus(input);
    expect(screen.getByRole("button", { name: "Sendai" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(screen.queryByRole("button", { name: "Sendai" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("worldline:search-history:v1")).toBeNull();
  });
});
