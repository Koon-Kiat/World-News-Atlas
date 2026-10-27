"use client";

import { Bookmark, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!profileOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [profileOpen]);

  return (
    <div className="header-tools" aria-label="Library and settings">
      <div ref={rootRef} className={profileOpen ? "profile-menu is-open" : "profile-menu"}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setProfileOpen(false); }}
        onKeyDown={(event) => { if (event.key === "Escape") { setProfileOpen(false); triggerRef.current?.focus(); } }}>
        <button
          ref={triggerRef}
          type="button"
          className={active === "settings" || active === "saved" ? "profile-button active" : "profile-button"}
          aria-label="Open library menu"
          aria-expanded={profileOpen}
          aria-controls={profileOpen ? panelId : undefined}
          onClick={() => setProfileOpen((current) => !current)}
        >
          <UserRound aria-hidden="true" />
          <span>Library</span>
          {count > 0 && <span className="profile-count" aria-label={`${count} saved articles`}>{count > 99 ? "99+" : count}</span>}
        </button>
        {profileOpen && <div className="profile-dropdown" id={panelId}>
          <div className="profile-dropdown-heading">
            <span>Your library</span>
            <strong>{count} saved</strong>
          </div>
          <Link href="/saved" className={active === "saved" ? "active" : ""}>
            <Bookmark aria-hidden="true" />
            <span><strong>Saved articles</strong><small>Read later on this device</small></span>
          </Link>
          {stories.slice(0, 2).map((story) => (
            <Link className="profile-saved-story" href={`/saved#${encodeURIComponent(story.id)}`} key={story.id} title={story.title}>
              {story.title}
            </Link>
          ))}
          <Link href="/settings" className={active === "settings" ? "active" : ""}>
            <Settings aria-hidden="true" />
            <span><strong>Settings</strong><small>Reading preferences</small></span>
          </Link>
        </div>}
      </div>
    </div>
  );
}
