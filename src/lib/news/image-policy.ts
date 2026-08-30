const APPROVED_ARTICLE_HOSTS = new Set([
  "feeds.bbci.co.uk",
  "news.sky.com",
  "news.web.nhk",
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
  "imgu.web.nhk",
  "media.npr.org",
  "news.web.nhk",
  "npr.brightspotcdn.com",
  "s.france24.com",
  "static.dw.com",
  "static.euronews.com",
  "www.aljazeera.com",
  "www.bing.com",
  "www.japantimes.co.jp",
  "www3.nhk.or.jp",
]);

export function parsedHttpsUrl(value: string | null | undefined): URL | null {
  if (!value || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function approvedArticleUrl(value: string | null | undefined): URL | null {
  const url = parsedHttpsUrl(value);
  return url && APPROVED_ARTICLE_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
}

export function approvedImageUrl(value: string | null | undefined): URL | null {
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
  if (host === "news.web.nhk" && !url.pathname.startsWith("/newsweb/")) return null;
  if (host === "imgu.web.nhk" && !url.pathname.startsWith("/news/")) return null;
  if (host === "www3.nhk.or.jp" && !url.pathname.startsWith("/news/")) return null;
  return url;
}
