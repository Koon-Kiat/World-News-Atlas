const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;

const APPROVED_ARTICLE_HOSTS = new Set([
  "feeds.bbci.co.uk",
  "news.sky.com",
  "www.aljazeera.com",
  "www.bbc.com",
  "www.channelnewsasia.com",
  "www.dw.com",
  "www.euronews.com",
  "www.france24.com",
  "www.japantimes.co.jp",
  "www.npr.org",
  "www.straitstimes.com",
  "www.theguardian.com",
]);

const APPROVED_IMAGE_HOSTS = new Set([
  "cassette.sphdigital.com.sg",
  "dam.mediacorp.sg",
  "e3.365dm.com",
  "i.guim.co.uk",
  "ichef.bbci.co.uk",
  "media.npr.org",
  "npr.brightspotcdn.com",
  "s.france24.com",
  "static.dw.com",
  "static.euronews.com",
  "www.aljazeera.com",
  "www.bing.com",
  "www.japantimes.co.jp",
]);

function parsedHttpsUrl(value: string | null): URL | null {
  if (!value || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function approvedArticleUrl(value: string | null): URL | null {
  const url = parsedHttpsUrl(value);
  return url && APPROVED_ARTICLE_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
}

function approvedImageUrl(value: string | null): URL | null {
  const url = parsedHttpsUrl(value);
  if (!url || !APPROVED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "www.japantimes.co.jp" &&
    !["/japantimes/uploads/images/", "/theme_japantimes/images/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  ) {
    return null;
  }
  if (host === "www.bing.com" && !url.pathname.startsWith("/th")) return null;
  if (host === "cassette.sphdigital.com.sg" && !url.pathname.startsWith("/image/")) return null;
  return url;
}

async function fetchWithReviewedRedirects(
  initialUrl: URL,
  approveRedirect: (value: string | null) => URL | null,
  accept: string,
  referer?: string,
): Promise<Response> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7_000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: accept,
          ...(referer ? { Referer: referer } : {}),
          "User-Agent": "WorldNewsAtlas/1.0",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? approveRedirect(new URL(location, current).toString()) : null;
      if (!next || redirect === 2) throw new Error("Unapproved redirect");
      current = next;
      continue;
    }
    return response;
  }
  throw new Error("Redirect limit exceeded");
}

function imageReferer(url: URL): string {
  if (url.hostname === "cassette.sphdigital.com.sg") return "https://www.straitstimes.com/";
  if (url.hostname === "dam.mediacorp.sg") return "https://www.channelnewsasia.com/";
  return `${url.protocol}//${url.hostname}/`;
}

function decodeHtmlUrl(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/")
    .replaceAll("&quot;", '"')
    .trim();
}

function articleImageUrl(html: string, articleUrl: URL): URL | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const type = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!["og:image", "og:image:secure_url", "twitter:image"].includes(type ?? "")) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    try {
      return approvedImageUrl(new URL(decodeHtmlUrl(content), articleUrl).toString());
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveArticleImage(articleUrl: URL): Promise<URL | null> {
  const response = await fetchWithReviewedRedirects(
    articleUrl,
    approvedArticleUrl,
    "text/html,application/xhtml+xml",
  );
  const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !["text/html", "application/xhtml+xml"].includes(contentType ?? "") || declaredLength > MAX_ARTICLE_BYTES) {
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_ARTICLE_BYTES) return null;
  return articleImageUrl(new TextDecoder().decode(bytes), articleUrl);
}

async function imageResponse(imageUrl: URL): Promise<Response> {
  const upstream = await fetchWithReviewedRedirects(
    imageUrl,
    approvedImageUrl,
    "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    imageReferer(imageUrl),
  );
  const contentType = upstream.headers.get("content-type")?.split(";")[0].toLowerCase();
  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (
    !upstream.ok ||
    !contentType?.match(/^image\/(?:avif|gif|jpeg|png|webp)$/) ||
    declaredLength > MAX_IMAGE_BYTES
  ) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const directImage = approvedImageUrl(parameters.get("url"));
  const article = approvedArticleUrl(parameters.get("article"));
  if (!directImage && !article) return new Response("Not found", { status: 404 });

  try {
    const imageUrl = directImage ?? (article ? await resolveArticleImage(article) : null);
    if (!imageUrl) return new Response("Not found", { status: 404 });
    return await imageResponse(imageUrl);
  } catch {
    return new Response("Image temporarily unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
