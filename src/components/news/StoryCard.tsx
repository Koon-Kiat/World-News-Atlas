/* eslint-disable @next/next/no-img-element */
"use client";

import { BookOpen, Bookmark, ExternalLink, Globe2 } from "lucide-react";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { relativeTime } from "@/lib/relative-time";
import { CountryFlag } from "@/components/CountryFlag";
import { SourceLabel } from "@/components/SourceLogo";
import { useSavedStories } from "@/hooks/useSavedStories";
import { getCountryName } from "@/lib/news/countries/metadata";
import { approvedArticleUrl, approvedImageUrl } from "@/lib/news/image-policy";
import type { ArticleView, StoryView } from "@/lib/news/types";
import { isSafeHttpUrl } from "@/lib/news/url";
const StoryReader = dynamic(() => import("./StoryReader").then((module) => module.StoryReader));

function displayImageUrl(
  imageUrl: string | null | undefined,
  articleUrl: string | null | undefined,
  topic: string,
): string | null {
  const topicParameter = `&topic=${encodeURIComponent(topic)}`;
  if (approvedImageUrl(imageUrl)) {
    const articleParameter = approvedArticleUrl(articleUrl) ? `&article=${encodeURIComponent(articleUrl!)}` : "";
    return `/api/image?url=${encodeURIComponent(imageUrl!)}${articleParameter}${topicParameter}`;
  }
  if (approvedArticleUrl(articleUrl)) return `/api/image?article=${encodeURIComponent(articleUrl!)}${topicParameter}`;
  return null;
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
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

export function StoryCard({ story, featured = false, referenceTime }: { story: StoryView; featured?: boolean; referenceTime?: string }) {
  const displayTime = (value: string) => referenceTime ? relativeTime(value, referenceTime) : value.slice(0, 10);
  const [readerOpen, setReaderOpen] = useState(false);
  const savedStories = useSavedStories();
  const closeReader = useCallback(() => setReaderOpen(false), []);
  const lead = story.articles[0];
  const imageArticle = story.articles.find((article) => isSafeHttpUrl(article.imageUrl));
  const primaryTopic = story.topics[0] ?? "world";
  const safeImage = displayImageUrl(imageArticle?.imageUrl, lead?.url, primaryTopic);
  const fallbackSource = imageArticle?.source.name ?? lead?.source.name ?? "World News Atlas";
  const sources = [...new Map(story.articles.map((article) => [article.source.id, article.source])).values()];

  return (
    <>
      <article id={story.id} className={featured ? "story-card is-featured has-media" : "story-card has-media"}>
      <button
        className="story-card-link"
        type="button"
        onClick={() => setReaderOpen(true)}
        aria-label={`Read ${story.title} in Worldline Reader`}
      />
      <div className={safeImage ? "story-image-wrap" : "story-image-wrap is-placeholder"}>
        <div className="story-image-fallback" aria-hidden="true">
          <Globe2 aria-hidden="true" />
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
        <button
          type="button"
          className={savedStories.isSaved(story.id) ? "save-story-button is-saved" : "save-story-button"}
          aria-label={savedStories.isSaved(story.id) ? `Remove ${story.title} from saved articles` : `Save ${story.title} for later`}
          aria-pressed={savedStories.isSaved(story.id)}
          title={savedStories.isSaved(story.id) ? "Remove from saved articles" : "Save for later"}
          onClick={(event) => {
            event.stopPropagation();
            savedStories.toggle(story);
          }}
        >
          <Bookmark aria-hidden="true" />
        </button>
      </div>
      <div className="story-body">
        <div className="story-kicker">
          <span>{story.topics[0] ?? "World"}</span>
          <span aria-hidden="true">•</span>
          <time dateTime={story.lastUpdatedAt}>{displayTime(story.lastUpdatedAt)}</time>
        </div>
        <h3>{story.title}</h3>
        {story.summary && <p className="story-summary">{story.summary}</p>}
        <div className="story-tags">
          {story.countries.map((country) => (
            <span key={country.code} className="country-tag">
              <CountryFlag code={country.code} />
              <span>{getCountryName(country.code)}</span>
            </span>
          ))}
          {story.countries.length === 0 && (
            <span className="country-tag is-global"><Globe2 aria-hidden="true" /><span>Global</span></span>
          )}
        </div>
        <div className="coverage-row">
          <div>
            <span className="coverage-sources source-label-list">{sources.slice(0, 3).map((source) => <SourceLabel key={source.id} source={source} />)}</span>
            <p className="coverage-count">Covered by {story.articles.length} {story.articles.length === 1 ? "source" : "sources"}</p>
          </div>
          <div className="story-actions">
            <button type="button" className="reader-link" onClick={() => setReaderOpen(true)}><BookOpen aria-hidden="true" />Reader</button>
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
                    <strong><SourceLabel source={article.source} /></strong>
                    <span>{article.source.countryCode ? getCountryName(article.source.countryCode) : "International"} · {displayTime(article.publishedAt)}</span>
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
