import { render as baseRender, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";
import { SavedStoriesProvider } from "@/hooks/useSavedStories";
export function render(ui: ReactNode, options?: RenderOptions) {
  return baseRender(ui, { wrapper: SavedStoriesProvider, ...options });
}
