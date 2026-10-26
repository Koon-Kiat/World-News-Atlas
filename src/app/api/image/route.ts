import { approvedArticleUrl, approvedImageUrl } from "@/lib/news/image-policy";
import { boundedStream, boundedText } from "@/lib/bounded-stream";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;

async function fetchWithReviewedRedirects(
  initialUrl: URL,
  approveRedirect: (value: string | null) => URL | null,
  accept: string,
  referer?: string,
): Promise<{ response: Response; signal: AbortSignal; finish: () => void }> {
  let current = initialUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  const finish = () => { clearTimeout(timer); controller.abort(); };
  try {
  for (let redirect = 0; redirect <= 2; redirect += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: accept,
          ...(referer ? { Referer: referer } : {}),
          "User-Agent": "WorldNewsAtlas/1.0",
        },
      });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      const next = location ? approveRedirect(new URL(location, current).toString()) : null;
      if (!next || redirect === 2) throw new Error("Unapproved redirect");
      current = next;
      continue;
    }
    return { response, signal: controller.signal, finish };
  }
  throw new Error("Redirect limit exceeded");
  } catch (error) { finish(); throw error; }
}

function imageReferer(url: URL): string {
  if (url.hostname === "cassette.sphdigital.com.sg") return "https://www.straitstimes.com/";
  if (url.hostname === "dam.mediacorp.sg") return "https://www.channelnewsasia.com/";
  if (url.hostname === "imgu.web.nhk") return "https://news.web.nhk/";
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
  const upstream = await fetchWithReviewedRedirects(
    articleUrl,
    approvedArticleUrl,
    "text/html,application/xhtml+xml",
  );
  const { response, signal, finish } = upstream;
  try {
  const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !["text/html", "application/xhtml+xml"].includes(contentType ?? "") || declaredLength > MAX_ARTICLE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    return null;
  }
  const html = await boundedText(response.body, MAX_ARTICLE_BYTES, signal);
  return articleImageUrl(html, articleUrl);
  } finally { finish(); }
}

async function imageResponse(imageUrl: URL): Promise<Response | null> {
  const reviewed = await fetchWithReviewedRedirects(
    imageUrl,
    approvedImageUrl,
    "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    imageReferer(imageUrl),
  );
  const { response: upstream, signal, finish } = reviewed;
  const contentType = upstream.headers.get("content-type")?.split(";")[0].toLowerCase();
  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (
    !upstream.ok ||
    !contentType?.match(/^image\/(?:avif|gif|jpeg|png|webp)$/) ||
    declaredLength > MAX_IMAGE_BYTES || !upstream.body
  ) {
    void upstream.body?.cancel().catch(() => undefined);
    finish();
    return null;
  }
  return new Response(boundedStream(upstream.body!, MAX_IMAGE_BYTES, signal, finish), {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": contentType,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function placeholderImageResponse(topicValue: string | null): Response {
  const topic = topicValue?.trim().toLowerCase().match(/^[a-z0-9-]{1,24}$/)?.[0] ?? "world";
  const label = `${topic[0]?.toUpperCase() ?? "W"}${topic.slice(1)} briefing`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${label}">
  <defs>
    <radialGradient id="a" cx="0" cy="0" r="1" gradientTransform="translate(260 120) rotate(31) scale(520 410)"><stop stop-color="#f56f52" stop-opacity=".55"/><stop offset="1" stop-color="#f56f52" stop-opacity="0"/></radialGradient>
    <radialGradient id="b" cx="0" cy="0" r="1" gradientTransform="translate(990 600) rotate(-142) scale(560 430)"><stop stop-color="#9fd1c6" stop-opacity=".34"/><stop offset="1" stop-color="#9fd1c6" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0v52" fill="none" stroke="#d9e7e2" stroke-opacity=".07"/></pattern>
  </defs>
  <rect width="1200" height="675" fill="#0c3036"/><rect width="1200" height="675" fill="url(#a)"/><rect width="1200" height="675" fill="url(#b)"/><rect width="1200" height="675" fill="url(#grid)"/>
  <g transform="translate(600 272)" fill="none" stroke="#d9e7e2" stroke-width="5" stroke-opacity=".8"><circle r="112"/><ellipse rx="52" ry="112"/><path d="M-108-35h216M-108 35h216M-112 0h224"/></g>
  <circle cx="690" cy="192" r="18" fill="#f56f52"/><text x="600" y="470" text-anchor="middle" fill="#f7f1e8" font-family="Arial,sans-serif" font-size="54">${label}</text><text x="600" y="520" text-anchor="middle" fill="#b8ccc7" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="5">WORLD NEWS ATLAS</text>
</svg>`;
  return new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const directImage = approvedImageUrl(parameters.get("url"));
  const article = approvedArticleUrl(parameters.get("article"));
  const topic = parameters.get("topic");
  if (!directImage && !article) return new Response("Not found", { status: 404 });

  try {
    if (directImage) {
      const directResponse = await imageResponse(directImage);
      if (directResponse) return directResponse;
    }
    if (article) {
      const articleImage = await resolveArticleImage(article);
      if (articleImage) {
        const articleResponse = await imageResponse(articleImage);
        if (articleResponse) return articleResponse;
      }
    }
    return placeholderImageResponse(topic);
  } catch {
    return placeholderImageResponse(topic);
  }
}
