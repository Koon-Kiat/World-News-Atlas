"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoryView } from "@/lib/news/types";

const STORAGE_KEY = "worldline:saved-stories:v1";
const CHANGE_EVENT = "worldline:saved-stories-changed";
const MAX_SAVED_STORIES = 50;

function isStoryView(value: unknown): value is StoryView {
  if (!value || typeof value !== "object") return false;
  const story = value as Partial<StoryView>;
  return typeof story.id === "string" && typeof story.title === "string" && Array.isArray(story.articles);
}

export function readSavedStories(): StoryView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isStoryView).slice(0, MAX_SAVED_STORIES) : [];
  } catch {
    return [];
  }
}

function writeSavedStories(stories: StoryView[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stories.slice(0, MAX_SAVED_STORIES)));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useSavedStories() {
  const [stories, setStories] = useState<StoryView[]>([]);

  useEffect(() => {
    const refresh = () => setStories(readSavedStories());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, []);

  const toggle = useCallback((story: StoryView) => {
    const current = readSavedStories();
    const next = current.some((item) => item.id === story.id)
      ? current.filter((item) => item.id !== story.id)
      : [story, ...current.filter((item) => item.id !== story.id)];
    writeSavedStories(next);
  }, []);

  const remove = useCallback((storyId: string) => {
    writeSavedStories(readSavedStories().filter((story) => story.id !== storyId));
  }, []);

  const clear = useCallback(() => writeSavedStories([]), []);

  return {
    stories,
    count: stories.length,
    isSaved: (storyId: string) => stories.some((story) => story.id === storyId),
    toggle,
    remove,
    clear,
  };
}
