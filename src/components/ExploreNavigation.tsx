import Link from "next/link";

export type ExploreSection = "country" | "compare" | "settings";

const sections: Array<{
  id: ExploreSection;
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
  {
    id: "settings",
    href: "/settings",
    number: "⚙",
    title: "Settings",
    description: "Time range and theme",
  },
];

export function ExploreNavigation({ active }: { active: ExploreSection }) {
  return (
    <nav className="explore-navigation" aria-label="World News Atlas sections">
      <div className="explore-navigation-inner">
        <p>
          <span>Explore mode</span>
          Choose how you want to read the world
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
      </div>
    </nav>
  );
}
