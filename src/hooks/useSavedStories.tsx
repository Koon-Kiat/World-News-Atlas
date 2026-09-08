"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { z } from "zod";
import type { StoryView } from "@/lib/news/types";

// Retain the key so existing v1 arrays can migrate safely to a versioned envelope.
export const SAVED_STORAGE_KEY = "worldline:saved-stories:v1";
const MAX_SAVED_STORIES = 50;
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const text = z.string().max(8_000);
const score = z.number().finite().min(0).max(1);
const country = z.object({ code: z.string().regex(/^[A-Z]{2}$/), name: text, relevanceScore: score });
const source = z.object({ id: text, name: text, domain: text.nullable(), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
  region: text.nullable(), language: text.nullable(), scope: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "INTERNATIONAL"]), qualityScore: score });
const httpUrl = z.string().max(8_000).refine((value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
});
const article = z.object({ id: text, provider: z.enum(["NEWSAPI", "GDELT", "RSS", "FIXTURE", "OTHER"]),
  providerArticleId: text, title: text, description: text.nullable(), url: httpUrl, canonicalUrl: httpUrl,
  imageUrl: httpUrl.nullable(), publishedAt: date, language: text, source,
  countries: z.array(country).max(250), topics: z.array(text).max(50), importanceScore: score, relevanceScore: score,
  isFixture: z.boolean().optional() });
const storySchema = z.object({ id: text, title: text, summary: text.nullable(), firstPublishedAt: date, lastUpdatedAt: date,
  countries: z.array(country).max(250), topics: z.array(text).max(50), importanceScore: score,
  articles: z.array(article).max(250), rankScore: score.optional() });

export function parseSavedStories(raw: string | null): StoryView[] {
  if (!raw || raw.length > 8_000_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" &&
      "version" in parsed && parsed.version === 2 && "stories" in parsed ? parsed.stories : [];
    if (!Array.isArray(records)) return [];
    const unique = new Map<string, StoryView>();
    for (const value of records.slice(0, MAX_SAVED_STORIES)) {
      const result = storySchema.safeParse(value);
      if (result.success) unique.set(result.data.id, result.data);
    }
    return [...unique.values()];
  } catch { return []; }
}

type Snapshot = { stories: StoryView[]; error: string | null; canUndo: boolean };
const empty: Snapshot = { stories: [], error: null, canUndo: false };
let snapshot: Snapshot = empty;
let undoStories: StoryView[] | null = null;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(next: Snapshot) { snapshot = next; listeners.forEach((listener) => listener()); }
export function readSavedStories(): StoryView[] {
  if (typeof window === "undefined") return [];
  try { return parseSavedStories(window.localStorage.getItem(SAVED_STORAGE_KEY)); }
  catch { return []; }
}
function cancelUndo() { clearTimeout(undoTimer); undoStories = null; }
function refresh() { cancelUndo(); publish({ stories: readSavedStories(), error: null, canUndo: false }); }
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_STORAGE_KEY) return;
  // Consume the delivered value; no additional disk read for each subscriber.
  cancelUndo(); publish({ stories: event.key === null ? [] : parseSavedStories(event.newValue), error: null, canUndo: false });
}
function subscribe(listener: () => void) {
  if (listeners.size === 0) { refresh(); window.addEventListener("storage", onStorage); }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { window.removeEventListener("storage", onStorage); cancelUndo(); }
  };
}
function write(stories: StoryView[], canUndo = false): boolean {
  const next = stories.slice(0, MAX_SAVED_STORIES);
  try {
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify({ version: 2, stories: next }));
    publish({ stories: next, error: null, canUndo });
    return true;
  } catch {
    publish({ ...snapshot, error: "Could not save your reading list. Browser storage may be full or unavailable." });
    return false;
  }
}
const actions = {
  toggle(story: StoryView) {
    if (snapshot.stories.some(({ id }) => id === story.id)) { actions.remove(story.id); return; }
    const valid = storySchema.safeParse(story);
    if (!valid.success) { publish({ ...snapshot, error: "This story could not be saved. Please refresh the briefing and try again." }); return; }
    if (write([valid.data, ...snapshot.stories])) cancelUndo();
  },
  remove(id: string) { if (write(snapshot.stories.filter((story) => story.id !== id))) cancelUndo(); },
  clear() {
    const previous = snapshot.stories;
    if (!previous.length || !write([], true)) return;
    cancelUndo(); undoStories = previous;
    undoTimer = setTimeout(() => { undoStories = null; publish({ ...snapshot, canUndo: false }); }, 10_000);
  },
  undo() { if (undoStories && write(undoStories)) cancelUndo(); },
};
const defaultValue = { ...empty, ...actions, count: 0, isSaved: (id: string) => empty.stories.some((story) => story.id === id) };
const SavedContext = createContext(defaultValue);

export function SavedStoriesProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => empty);
  return <SavedContext.Provider value={{ ...state, ...actions, count: state.stories.length,
    isSaved: (id) => state.stories.some((story) => story.id === id) }}>
    {children}
    {(state.error || state.canUndo) && <div className="saved-feedback" role="status">
      {state.error ?? "Reading list cleared"}
      {state.canUndo && <button type="button" onClick={actions.undo}>Undo</button>}
    </div>}
  </SavedContext.Provider>;
}

export function useSavedStories() { return useContext(SavedContext); }
