/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useState } from "react";
import { CountryFlag } from "@/components/CountryFlag";
import { getCountryName } from "@/lib/news/countries/metadata";
import { approvedArticleUrl, approvedImageUrl } from "@/lib/news/image-policy";
import type { ArticleView, StoryView } from "@/lib/news/types";
import { isSafeHttpUrl } from "@/lib/news/url";
import { StoryReader } from "./StoryReader";

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
      aria-label={`Read at ${article.source.name}`}
      title={`Read at ${article.source.name}`}
    >
      <span>Read source</span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7 4h9v9M16 4 8.5 11.5M14 10v5H5V6h5" />
      </svg>
    </a>
  );
}

export function StoryCard({ story, featured = false }: { story: StoryView; featured?: boolean }) {
  const [readerOpen, setReaderOpen] = useState(false);
  const closeReader = useCallback(() => setReaderOpen(false), []);
  const lead = story.articles[0];
  const imageArticle = story.articles.find((article) => isSafeHttpUrl(article.imageUrl));
  const primaryTopic = story.topics[0] ?? "world";
  const safeImage = displayImageUrl(imageArticle?.imageUrl, lead?.url, primaryTopic);
  const fallbackSource = imageArticle?.source.name ?? lead?.source.name ?? "World News Atlas";
  const sourceNames = [...new Set(story.articles.map((article) => article.source.name))];

  return (
    <>
      <article className={featured ? "story-card is-featured has-media" : "story-card has-media"}>
      <button
        className="story-card-link"
        type="button"
        onClick={() => setReaderOpen(true)}
        aria-label={`Read ${story.title} in Worldline Reader`}
      />
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
              <CountryFlag code={country.code} />
              {getCountryName(country.code)}
            </span>
          ))}
          {story.countries.length === 0 && (
            <span className="country-tag is-global"><span aria-hidden="true">🌐</span>Global</span>
          )}
        </div>
        <div className="coverage-row">
          <div>
            <p className="coverage-sources">{sourceNames.slice(0, 3).join(" · ")}</p>
            <p className="coverage-count">Covered by {story.articles.length} {story.articles.length === 1 ? "source" : "sources"}</p>
          </div>
          <div className="story-actions">
            <button type="button" className="reader-link" onClick={() => setReaderOpen(true)}>Reader</button>
            {lead && <ArticleLink article={lead} />}
          </div>
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
      {readerOpen && <StoryReader story={story} imageUrl={safeImage} onClose={closeReader} />}
    </>
  );
}
