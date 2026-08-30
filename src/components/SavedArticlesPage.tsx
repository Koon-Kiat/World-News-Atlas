"use client";

import Link from "next/link";
import { ExploreNavigation, HeaderTools } from "@/components/ExploreNavigation";
import { StoryList } from "@/components/news/StoryList";
import { useSavedStories } from "@/hooks/useSavedStories";

export function SavedArticlesPage() {
  const saved = useSavedStories();

  return (
    <div className="site-frame" id="top">
      <header className="site-header saved-site-header">
        <Link className="brand" href="/" aria-label="Worldline home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <ExploreNavigation active="saved" />
        <p>Saved articles</p>
        <HeaderTools active="saved" />
      </header>

      <main className="saved-page">
        <section className="saved-intro" aria-labelledby="saved-title">
          <div>
            <p className="eyebrow">Your reading list</p>
            <h1 id="saved-title">Saved articles.</h1>
            <p>Stories you bookmark stay in this browser so you can return to them later.</p>
          </div>
          {saved.count > 0 && <button type="button" onClick={saved.clear}>Clear all</button>}
        </section>

        {saved.count > 0 ? (
          <StoryList stories={saved.stories} />
        ) : (
          <div className="saved-empty-state">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" /></svg>
            <h2>Your reading list is empty.</h2>
            <p>Use the bookmark button on any news card to save it here.</p>
            <Link href="/country#stories">Browse the latest stories</Link>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>WORLDLINE</span></div>
        <p>Saved articles are stored only in this browser.</p>
        <Link href="/country#stories">Back to stories ↑</Link>
      </footer>
    </div>
  );
}
