import Link from "next/link";
import { ThemeControl } from "@/components/ThemeControl";

export type ExploreSection = "country" | "compare" | "settings";

const sections: Array<{
  id: "country" | "compare";
  href: string;
  number: string;
  title: string;
  description: string;
}> = [
  {
    id: "country",
    href: "/country#top",
    number: "01",
    title: "One country",
    description: "Follow one place",
  },
  {
    id: "compare",
    href: "/compare#top",
    number: "02",
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
            <span aria-hidden="true">{section.number}</span>
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
        <span aria-hidden="true">⚙</span>
      </Link>
      <ThemeControl compact />
    </div>
  );
}
