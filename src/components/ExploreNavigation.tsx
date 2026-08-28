import Link from "next/link";
import { ThemeControl } from "@/components/ThemeControl";

export type ExploreSection = "country" | "compare" | "settings";

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
  return (
    <div className="header-tools" aria-label="Settings and appearance">
      <Link
        href="/settings"
        className={active === "settings" ? "settings-link active" : "settings-link"}
        aria-current={active === "settings" ? "page" : undefined}
        aria-label="Open settings"
        title="Settings"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.04 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      </Link>
      <ThemeControl compact />
    </div>
  );
}
