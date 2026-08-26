const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const JAPAN_TIMES_HOST = "www.japantimes.co.jp";
const ALLOWED_PATH_PREFIXES = [
  "/japantimes/uploads/images/",
  "/theme_japantimes/images/",
];

function approvedImageUrl(value: string | null): URL | null {
  if (!value || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== JAPAN_TIMES_HOST ||
      url.username ||
      url.password ||
      !ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fetchApprovedImage(initialUrl: URL): Promise<Response> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 1; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7_000);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          Referer: "https://www.japantimes.co.jp/",
          "User-Agent": "WorldNewsAtlas/1.0",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = approvedImageUrl(response.headers.get("location"));
      if (!location || redirect === 1) throw new Error("Unapproved image redirect");
      current = location;
      continue;
    }
    return response;
  }
  throw new Error("Image redirect limit exceeded");
}

export async function GET(request: Request): Promise<Response> {
  const imageUrl = approvedImageUrl(new URL(request.url).searchParams.get("url"));
  if (!imageUrl) return new Response("Not found", { status: 404 });

  try {
    const upstream = await fetchApprovedImage(imageUrl);
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
  } catch {
    return new Response("Image temporarily unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
