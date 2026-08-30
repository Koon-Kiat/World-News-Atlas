import type { ArticleView, SourceReference, StoryView } from "@/lib/news/types";

const image = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=78`;

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const fixtureUrl = (slug: string) =>
  `https://example.com/world-news-atlas/fixtures/${slug}`;

const source = (
  name: string,
  countryCode: string | null,
  scope: SourceReference["scope"],
  language = "en",
): SourceReference => ({
  id: `fixture:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
  name,
  domain: "example.com",
  countryCode,
  region: null,
  language,
  scope,
  qualityScore: 0.78,
});

function article(
  id: string,
  title: string,
  description: string,
  publishedHoursAgo: number,
  publisher: SourceReference,
  countries: Array<[string, string, number]>,
  topics: string[],
  imageUrl: string,
): ArticleView {
  const url = fixtureUrl(id);
  return {
    id: `fixture-article-${id}`,
    provider: "FIXTURE",
    providerArticleId: id,
    title,
    description,
    url,
    canonicalUrl: url,
    imageUrl,
    publishedAt: hoursAgo(publishedHoursAgo),
    language: publisher.language ?? "en",
    source: publisher,
    countries: countries.map(([code, name, relevanceScore]) => ({
      code,
      name,
      relevanceScore,
    })),
    topics,
    importanceScore: 0.78,
    relevanceScore: 0.86,
    isFixture: true,
  };
}

export function getFixtureStories(): StoryView[] {
  const jp = source("Tokyo Ledger — demo", "JP", "NATIONAL");
  const sg = source("Merlion Dispatch — demo", "SG", "NATIONAL");
  const intl = source("Global Current — demo", "GB", "INTERNATIONAL");
  const us = source("Atlantic Report — demo", "US", "NATIONAL");
  const cn = source("East Asia Monitor — demo", "CN", "NATIONAL");
  const inSource = source("Delhi Public Desk — demo", "IN", "NATIONAL");
  const au = source("Southern Cross News — demo", "AU", "NATIONAL");
  const id = source("Nusantara Daily — demo", "ID", "NATIONAL");
  const br = source("Brasilia Journal — demo", "BR", "NATIONAL");
  const de = source("Europa Brief — demo", "DE", "INTERNATIONAL");
  const za = source("Cape Public News — demo", "ZA", "NATIONAL");
  const ke = source("Nairobi Dispatch — demo", "KE", "NATIONAL");

  return [
    {
      id: "fixture-story-jp-sg-digital-corridor",
      title: "Japan and Singapore outline a shared digital shipping corridor",
      summary:
        "Officials and port operators set out a trial for compatible trade documents and lower-emission shipping data.",
      firstPublishedAt: hoursAgo(9),
      lastUpdatedAt: hoursAgo(2),
      countries: [
        { code: "JP", name: "Japan", relevanceScore: 0.99 },
        { code: "SG", name: "Singapore", relevanceScore: 0.99 },
      ],
      topics: ["technology", "business", "transport"],
      importanceScore: 0.93,
      articles: [
        article(
          "jp-sg-digital-corridor-tokyo",
          "Japan, Singapore ports begin digital corridor pilot",
          "The trial focuses on interoperable documents and vessel efficiency data.",
          9,
          jp,
          [["JP", "Japan", 1], ["SG", "Singapore", 0.96]],
          ["technology", "transport"],
          image("photo-1578575437130-527eed3abbec"),
        ),
        article(
          "jp-sg-digital-corridor-merlion",
          "Singapore and Japan link trade systems in new port project",
          "Agencies from both countries will test digital documentation on selected routes.",
          6,
          sg,
          [["SG", "Singapore", 1], ["JP", "Japan", 0.97]],
          ["technology", "business"],
          image("photo-1578575437130-527eed3abbec"),
        ),
        article(
          "jp-sg-digital-corridor-global",
          "New Japan–Singapore corridor targets faster, greener shipping",
          "The bilateral project is expected to inform wider standards for Asian ports.",
          2,
          intl,
          [["JP", "Japan", 0.96], ["SG", "Singapore", 0.96]],
          ["transport", "business"],
          image("photo-1578575437130-527eed3abbec"),
        ),
      ],
    },
    {
      id: "fixture-story-japan-chip-investment",
      title: "Japan expands regional semiconductor research programme",
      summary:
        "A new funding round backs university and industry partnerships focused on advanced chip packaging.",
      firstPublishedAt: hoursAgo(13),
      lastUpdatedAt: hoursAgo(5),
      countries: [{ code: "JP", name: "Japan", relevanceScore: 1 }],
      topics: ["technology", "business"],
      importanceScore: 0.86,
      articles: [
        article(
          "japan-chip-investment-tokyo",
          "Japan funds advanced semiconductor research hubs",
          "The programme links laboratories in Tokyo and Osaka with domestic manufacturers.",
          13,
          jp,
          [["JP", "Japan", 1]],
          ["technology", "business"],
          image("photo-1518770660439-4636190af475"),
        ),
        article(
          "japan-chip-investment-global",
          "Japan adds new incentives to strengthen chip research",
          "International suppliers are assessing how the research grants could shape regional capacity.",
          5,
          intl,
          [["JP", "Japan", 0.96]],
          ["technology", "business"],
          image("photo-1518770660439-4636190af475"),
        ),
      ],
    },
    {
      id: "fixture-story-singapore-coastal-plan",
      title: "Singapore details the next phase of its coastal resilience plan",
      summary:
        "The programme combines tidal monitoring, drainage upgrades and community consultation for exposed districts.",
      firstPublishedAt: hoursAgo(19),
      lastUpdatedAt: hoursAgo(7),
      countries: [{ code: "SG", name: "Singapore", relevanceScore: 1 }],
      topics: ["climate", "society"],
      importanceScore: 0.84,
      articles: [
        article(
          "singapore-coastal-plan-merlion",
          "Singapore opens consultation on eastern coastal defences",
          "Residents and businesses will be invited to review early adaptation options.",
          19,
          sg,
          [["SG", "Singapore", 1]],
          ["climate", "society"],
          image("photo-1507525428034-b723cf961d3e"),
        ),
        article(
          "singapore-coastal-plan-global",
          "Singapore combines sensors and infrastructure in coastal strategy",
          "The city-state's phased approach is being watched by other low-lying urban centres.",
          7,
          intl,
          [["SG", "Singapore", 0.97]],
          ["climate", "technology"],
          image("photo-1507525428034-b723cf961d3e"),
        ),
      ],
    },
    {
      id: "fixture-story-us-cn-ai-talks",
      title: "United States and China resume technical talks on AI safeguards",
      summary:
        "Specialist delegations met to compare incident reporting practices while wider technology restrictions remain contested.",
      firstPublishedAt: hoursAgo(16),
      lastUpdatedAt: hoursAgo(3),
      countries: [
        { code: "US", name: "United States of America", relevanceScore: 0.98 },
        { code: "CN", name: "China", relevanceScore: 0.98 },
      ],
      topics: ["technology", "politics"],
      importanceScore: 0.95,
      articles: [
        article("us-cn-ai-talks-us", "U.S. and China reopen expert channel on AI risk", "The talks cover testing, incident notification and definitions of high-risk systems.", 16, us, [["US", "United States of America", 1], ["CN", "China", 0.96]], ["technology", "politics"], image("photo-1516321318423-f06f85e504b3")),
        article("us-cn-ai-talks-cn", "China, United States hold new artificial intelligence dialogue", "Both delegations described the technical exchange as useful but preliminary.", 8, cn, [["CN", "China", 1], ["US", "United States of America", 0.95]], ["technology", "politics"], image("photo-1516321318423-f06f85e504b3")),
        article("us-cn-ai-talks-global", "AI safety channel reopens between Washington and Beijing", "The meeting offers a limited cooperation track amid persistent commercial tensions.", 3, intl, [["US", "United States of America", 0.94], ["CN", "China", 0.94]], ["technology", "politics"], image("photo-1516321318423-f06f85e504b3")),
      ],
    },
    {
      id: "fixture-story-india-japan-rail",
      title: "India and Japan broaden joint rail engineering programme",
      summary:
        "The next phase adds station design, safety training and supply-chain work to the bilateral transport partnership.",
      firstPublishedAt: hoursAgo(28),
      lastUpdatedAt: hoursAgo(11),
      countries: [{ code: "IN", name: "India", relevanceScore: 0.98 }, { code: "JP", name: "Japan", relevanceScore: 0.98 }],
      topics: ["transport", "business"],
      importanceScore: 0.83,
      articles: [
        article("india-japan-rail-delhi", "India and Japan add safety training to rail partnership", "Engineering institutes will exchange staff under the expanded programme.", 28, inSource, [["IN", "India", 1], ["JP", "Japan", 0.94]], ["transport", "business"], image("photo-1474487548417-781cb71495f3")),
        article("india-japan-rail-tokyo", "Japanese rail groups join expanded India engineering project", "Companies will support training and component testing alongside public agencies.", 11, jp, [["JP", "Japan", 1], ["IN", "India", 0.95]], ["transport", "business"], image("photo-1474487548417-781cb71495f3")),
      ],
    },
    {
      id: "fixture-story-australia-indonesia-air",
      title: "Australia and Indonesia agree to expand regional air links",
      summary:
        "The arrangement creates room for new routes beyond the busiest gateways and adds joint tourism promotion.",
      firstPublishedAt: hoursAgo(31),
      lastUpdatedAt: hoursAgo(14),
      countries: [{ code: "AU", name: "Australia", relevanceScore: 0.97 }, { code: "ID", name: "Indonesia", relevanceScore: 0.97 }],
      topics: ["transport", "business", "culture"],
      importanceScore: 0.79,
      articles: [
        article("australia-indonesia-air-au", "Australia, Indonesia make room for more regional flights", "The aviation agreement targets secondary cities and seasonal routes.", 31, au, [["AU", "Australia", 1], ["ID", "Indonesia", 0.94]], ["transport", "business"], image("photo-1436491865332-7a61a109cc05")),
        article("australia-indonesia-air-id", "Indonesia and Australia plan joint tourism route campaign", "Officials will promote routes that connect travellers with destinations beyond major hubs.", 14, id, [["ID", "Indonesia", 1], ["AU", "Australia", 0.94]], ["transport", "culture"], image("photo-1436491865332-7a61a109cc05")),
      ],
    },
    {
      id: "fixture-story-brazil-germany-climate",
      title: "Brazil and Germany launch a forest finance verification trial",
      summary:
        "The bilateral pilot links public funding to independently checked conservation and community safeguards.",
      firstPublishedAt: hoursAgo(39),
      lastUpdatedAt: hoursAgo(20),
      countries: [{ code: "BR", name: "Brazil", relevanceScore: 0.98 }, { code: "DE", name: "Germany", relevanceScore: 0.96 }],
      topics: ["climate", "business", "politics"],
      importanceScore: 0.88,
      articles: [
        article("brazil-germany-climate-br", "Brazil, Germany test new forest finance safeguards", "The pilot will publish verification data and community impact measures.", 39, br, [["BR", "Brazil", 1], ["DE", "Germany", 0.92]], ["climate", "business"], image("photo-1516026672322-bc52d61a55d5")),
        article("brazil-germany-climate-de", "German fund backs verified conservation projects in Brazil", "The programme links staged payments to independently assessed outcomes.", 20, de, [["DE", "Germany", 1], ["BR", "Brazil", 0.95]], ["climate", "business"], image("photo-1516026672322-bc52d61a55d5")),
      ],
    },
    {
      id: "fixture-story-africa-clean-grid",
      title: "South Africa and Kenya lead new clean-grid training network",
      summary:
        "Power-system engineers will share grid balancing research and placements through a regional programme.",
      firstPublishedAt: hoursAgo(46),
      lastUpdatedAt: hoursAgo(25),
      countries: [{ code: "ZA", name: "South Africa", relevanceScore: 0.96 }, { code: "KE", name: "Kenya", relevanceScore: 0.96 }],
      topics: ["climate", "technology", "business"],
      importanceScore: 0.81,
      articles: [
        article("africa-clean-grid-za", "South Africa joins Kenya in grid engineering exchange", "Utilities and universities will coordinate placements and open training material.", 46, za, [["ZA", "South Africa", 1], ["KE", "Kenya", 0.93]], ["climate", "technology"], image("photo-1473341304170-971dccb5ac1e")),
        article("africa-clean-grid-ke", "Kenya and South Africa establish clean-power training network", "The first cohort will focus on storage integration and grid resilience.", 25, ke, [["KE", "Kenya", 1], ["ZA", "South Africa", 0.93]], ["climate", "technology"], image("photo-1473341304170-971dccb5ac1e")),
      ],
    },
  ];
}
