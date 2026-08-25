-- CreateEnum
CREATE TYPE "ProviderName" AS ENUM ('NEWSAPI', 'GDELT', 'RSS', 'FIXTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceScope" AS ENUM ('LOCAL', 'REGIONAL', 'NATIONAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Country" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "countryCode" CHAR(2),
    "region" TEXT,
    "language" VARCHAR(12),
    "scope" "SourceScope" NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceProviderIdentifier" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceProviderIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "providerArticleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "language" VARCHAR(12) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleProviderRef" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "providerArticleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleProviderRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleCountry" (
    "articleId" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    CONSTRAINT "ArticleCountry_pkey" PRIMARY KEY ("articleId","countryCode")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleTopic" (
    "articleId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    CONSTRAINT "ArticleTopic_pkey" PRIMARY KEY ("articleId","topicId")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "firstPublishedAt" TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "clusterScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryArticle" (
    "storyId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    CONSTRAINT "StoryArticle_pkey" PRIMARY KEY ("storyId","articleId")
);

-- CreateTable
CREATE TABLE "StoryCountry" (
    "storyId" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    CONSTRAINT "StoryCountry_pkey" PRIMARY KEY ("storyId","countryCode")
);

-- CreateTable
CREATE TABLE "StoryTopic" (
    "storyId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    CONSTRAINT "StoryTopic_pkey" PRIMARY KEY ("storyId","topicId")
);

-- CreateTable
CREATE TABLE "ProviderIngestionRun" (
    "id" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "storedCount" INTEGER NOT NULL DEFAULT 0,
    "storiesUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    CONSTRAINT "ProviderIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_domain_key" ON "Source"("domain");
CREATE INDEX "Source_countryCode_scope_idx" ON "Source"("countryCode", "scope");
CREATE UNIQUE INDEX "Source_name_countryCode_key" ON "Source"("name", "countryCode");
CREATE INDEX "SourceProviderIdentifier_sourceId_idx" ON "SourceProviderIdentifier"("sourceId");
CREATE UNIQUE INDEX "SourceProviderIdentifier_provider_identifier_key" ON "SourceProviderIdentifier"("provider", "identifier");
CREATE UNIQUE INDEX "Article_canonicalUrl_key" ON "Article"("canonicalUrl");
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt" DESC);
CREATE INDEX "Article_sourceId_publishedAt_idx" ON "Article"("sourceId", "publishedAt" DESC);
CREATE INDEX "Article_language_publishedAt_idx" ON "Article"("language", "publishedAt" DESC);
CREATE UNIQUE INDEX "Article_provider_providerArticleId_key" ON "Article"("provider", "providerArticleId");
CREATE INDEX "ArticleProviderRef_articleId_idx" ON "ArticleProviderRef"("articleId");
CREATE UNIQUE INDEX "ArticleProviderRef_provider_providerArticleId_key" ON "ArticleProviderRef"("provider", "providerArticleId");
CREATE INDEX "ArticleCountry_countryCode_articleId_idx" ON "ArticleCountry"("countryCode", "articleId");
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");
CREATE INDEX "ArticleTopic_topicId_articleId_idx" ON "ArticleTopic"("topicId", "articleId");
CREATE UNIQUE INDEX "Story_fingerprint_key" ON "Story"("fingerprint");
CREATE INDEX "Story_lastUpdatedAt_idx" ON "Story"("lastUpdatedAt" DESC);
CREATE INDEX "Story_importanceScore_lastUpdatedAt_idx" ON "Story"("importanceScore" DESC, "lastUpdatedAt" DESC);
CREATE INDEX "StoryArticle_articleId_idx" ON "StoryArticle"("articleId");
CREATE INDEX "StoryCountry_countryCode_storyId_idx" ON "StoryCountry"("countryCode", "storyId");
CREATE INDEX "StoryTopic_topicId_storyId_idx" ON "StoryTopic"("topicId", "storyId");
CREATE INDEX "ProviderIngestionRun_provider_startedAt_idx" ON "ProviderIngestionRun"("provider", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceProviderIdentifier" ADD CONSTRAINT "SourceProviderIdentifier_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticleProviderRef" ADD CONSTRAINT "ArticleProviderRef_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleCountry" ADD CONSTRAINT "ArticleCountry_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleCountry" ADD CONSTRAINT "ArticleCountry_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleTopic" ADD CONSTRAINT "ArticleTopic_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleTopic" ADD CONSTRAINT "ArticleTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryArticle" ADD CONSTRAINT "StoryArticle_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryArticle" ADD CONSTRAINT "StoryArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryCountry" ADD CONSTRAINT "StoryCountry_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryCountry" ADD CONSTRAINT "StoryCountry_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryTopic" ADD CONSTRAINT "StoryTopic_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryTopic" ADD CONSTRAINT "StoryTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
