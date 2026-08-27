import Link from "next/link";
import { ThemeControl } from "@/components/ThemeControl";

export type ExploreSection = "home" | "country" | "compare" | "settings";

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
    <nav className="explore-navigation" aria-label="World News Atlas sections">
      <div className="explore-navigation-inner">
        <p>
          <span>Explore mode</span>
          Read the world your way
        </p>
        <div className="explore-navigation-links">
          {sections.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              className={active === section.id ? "active" : ""}
              aria-current={active === section.id ? "page" : undefined}
            >
              <span aria-hidden="true">{section.number}</span>
              <span>
                <strong>{section.title}</strong>
                <small>{section.description}</small>
              </span>
            </Link>
          ))}
        </div>
        <div className="explore-navigation-tools">
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
      </div>
    </nav>
  );
}
