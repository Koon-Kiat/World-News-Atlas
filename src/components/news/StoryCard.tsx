/* eslint-disable @next/next/no-img-element */
import { getCountryName } from "@/lib/news/countries/metadata";
import { approvedArticleUrl, approvedImageUrl } from "@/lib/news/image-policy";
import type { ArticleView, StoryView } from "@/lib/news/types";
import { isSafeHttpUrl } from "@/lib/news/url";

function flag(code: string): string {
  return String.fromCodePoint(...code.split("").map((character) => 127397 + character.charCodeAt(0)));
}

function displayImageUrl(
  imageUrl: string | null | undefined,
  articleUrl: string | null | undefined,
  topic: string,
): string | null {
  const topicParameter = `&topic=${encodeURIComponent(topic)}`;
  if (approvedImageUrl(imageUrl)) return `/api/image?url=${encodeURIComponent(imageUrl!)}${topicParameter}`;
  if (approvedArticleUrl(articleUrl)) return `/api/image?article=${encodeURIComponent(articleUrl!)}${topicParameter}`;
  return null;
}

function relativeTime(value: string): string {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ArticleLink({ article }: { article: ArticleView }) {
  if (article.isFixture || !isSafeHttpUrl(article.url)) {
    return <span className="article-link is-sample">Sample article</span>;
  }
  return (
    <a
      className="article-link"
      href={article.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="strict-origin-when-cross-origin"
    >
      Read at {article.source.name} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function StoryCard({ story, featured = false }: { story: StoryView; featured?: boolean }) {
  const lead = story.articles[0];
  const imageArticle = story.articles.find((article) => isSafeHttpUrl(article.imageUrl));
  const primaryTopic = story.topics[0] ?? "world";
  const safeImage = displayImageUrl(imageArticle?.imageUrl, lead?.url, primaryTopic);
  const fallbackSource = imageArticle?.source.name ?? lead?.source.name ?? "World News Atlas";
  const sourceNames = [...new Set(story.articles.map((article) => article.source.name))];
  const cardUrl = lead && !lead.isFixture && isSafeHttpUrl(lead.url) ? lead.url : null;

  return (
    <article className={featured ? "story-card is-featured has-media" : "story-card has-media"}>
      {cardUrl && (
        <a
          className="story-card-link"
          href={cardUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="strict-origin-when-cross-origin"
          aria-label={`Read ${story.title} at ${lead.source.name}`}
        />
      )}
      <div className={safeImage ? "story-image-wrap" : "story-image-wrap is-placeholder"}>
        <div className="story-image-fallback" aria-hidden="true">
          <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="29"/><ellipse cx="40" cy="40" rx="13" ry="29"/><path d="M12 40h56M18 27h44M18 53h44"/><circle className="story-image-fallback-dot" cx="60" cy="20" r="5"/></svg>
          <strong>{primaryTopic} briefing</strong>
          <small>{fallbackSource}</small>
        </div>
        {safeImage && (
          <img
            src={safeImage}
            alt=""
            className="story-image"
            loading={featured ? "eager" : "lazy"}
            fetchPriority={featured ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.display = "none";
              event.currentTarget.parentElement?.classList.add("is-placeholder");
            }}
          />
        )}
        <span className="image-shade" />
        <span className="story-rank">{featured ? "Lead story" : "Developing"}</span>
      </div>
      <div className="story-body">
        <div className="story-kicker">
          <span>{story.topics[0] ?? "World"}</span>
          <span aria-hidden="true">•</span>
          <time dateTime={story.lastUpdatedAt}>{relativeTime(story.lastUpdatedAt)}</time>
        </div>
        <h3>{story.title}</h3>
        {story.summary && <p className="story-summary">{story.summary}</p>}
        <div className="story-tags">
          {story.countries.map((country) => (
            <span key={country.code} className="country-tag">
              <span aria-hidden="true">{flag(country.code)}</span>
              {getCountryName(country.code)}
            </span>
          ))}
        </div>
        <div className="coverage-row">
          <div>
            <p className="coverage-sources">{sourceNames.slice(0, 3).join(" · ")}</p>
            <p className="coverage-count">Covered by {story.articles.length} {story.articles.length === 1 ? "source" : "sources"}</p>
          </div>
          {lead && <ArticleLink article={lead} />}
        </div>
        {story.articles.length > 1 && (
          <details className="coverage-details">
            <summary>View coverage</summary>
            <ul>
              {story.articles.map((article) => (
                <li key={article.id}>
                  <div>
                    <strong>{article.source.name}</strong>
                    <span>{article.source.countryCode ? getCountryName(article.source.countryCode) : "International"} · {relativeTime(article.publishedAt)}</span>
                  </div>
                  <ArticleLink article={article} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
