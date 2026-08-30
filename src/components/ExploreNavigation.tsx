"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeControl } from "@/components/ThemeControl";
import { useSavedStories } from "@/hooks/useSavedStories";

export type ExploreSection = "country" | "compare" | "saved" | "settings";

const sections: Array<{
  id: "country" | "compare";
  href: string;
  title: string;
  description: string;
}> = [
  {
    id: "country",
    href: "/country#top",
    title: "One country",
    description: "Follow one place",
  },
  {
    id: "compare",
    href: "/compare#top",
    title: "Compare two",
    description: "Find shared stories",
  },
];

export function ExploreNavigation({ active }: { active: ExploreSection }) {
  return (
    <nav className="header-mode-navigation" aria-label="World News Atlas sections">
      <div className="header-mode-links">
        {sections.map((section) => (
          <Link
            key={section.id}
            href={section.href}
            className={active === section.id ? "active" : ""}
            aria-current={active === section.id ? "page" : undefined}
            title={section.description}
          >
            <strong>{section.title}</strong>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function HeaderTools({ active }: { active: ExploreSection }) {
  const { stories, count } = useSavedStories();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="header-tools" aria-label="Settings and appearance">
      <ThemeControl compact />
      <div className={profileOpen ? "profile-menu is-open" : "profile-menu"}>
        <button
          type="button"
          className={active === "settings" || active === "saved" ? "profile-button active" : "profile-button"}
          aria-label="Open profile menu"
          aria-expanded={profileOpen}
          title="Profile"
          onClick={() => setProfileOpen((current) => !current)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
          </svg>
          {count > 0 && <span className="profile-count" aria-label={`${count} saved articles`}>{count > 99 ? "99+" : count}</span>}
        </button>
        {profileOpen && <div className="profile-dropdown">
          <div className="profile-dropdown-heading">
            <span>Your library</span>
            <strong>{count} saved</strong>
          </div>
          <Link href="/saved" className={active === "saved" ? "active" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z" /></svg>
            <span><strong>Saved articles</strong><small>Read later on this device</small></span>
          </Link>
          {stories.slice(0, 2).map((story) => (
            <Link className="profile-saved-story" href={`/saved#${encodeURIComponent(story.id)}`} key={story.id} title={story.title}>
              {story.title}
            </Link>
          ))}
          <Link href="/settings" className={active === "settings" ? "active" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.12-1.3l2-1.55-2-3.46-2.45 1A7 7 0 0 0 14.2 5.4L13.85 3h-4l-.35 2.4a7 7 0 0 0-2.23 1.29l-2.45-1-2 3.46 2 1.55A7 7 0 0 0 4.7 12c0 .45.04.88.12 1.3l-2 1.55 2 3.46 2.45-1A7 7 0 0 0 9.5 18.6l.35 2.4h4l.35-2.4a7 7 0 0 0 2.23-1.29l2.45 1 2-3.46-2-1.55c.08-.42.12-.85.12-1.3Z" /></svg>
            <span><strong>Settings</strong><small>Range and appearance</small></span>
          </Link>
        </div>}
      </div>
    </div>
  );
}
