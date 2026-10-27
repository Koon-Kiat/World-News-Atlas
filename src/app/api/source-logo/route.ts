import { getDomain } from "tldts";
import { boundedStream } from "@/lib/bounded-stream";

function unavailable(status = 404) {
  return new Response(null, { status, headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).searchParams.get("domain")?.toLowerCase();
  // Accept a public hostname only. The upstream host/path are always fixed;
  // publisher domains are data, never a network destination for this Worker.
  if (!domain || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || !getDomain(domain)) return unavailable(400);
  const url = new URL("https://t2.gstatic.com/faviconV2");
  for (const [key, value] of Object.entries({ client: "SOCIAL", type: "FAVICON", fallback_opts: "TYPE,SIZE,URL", url: `https://${domain}`, size: "32" })) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    // Workers support manual/follow only. Manual preserves the fixed upstream
    // boundary: a redirect is an unavailable logo, never another fetch target.
    const response = await fetch(url, { redirect: "manual", signal: controller.signal });
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    if (!response.ok || !response.body || !["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"].includes(type ?? "")) {
      await response.body?.cancel();
      return unavailable();
    }
    const bytes = await new Response(boundedStream(response.body, 64 * 1024, controller.signal)).arrayBuffer();
    return new Response(bytes, { headers: { "Content-Type": type!, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" } });
  } catch { return unavailable(); }
  finally { clearTimeout(timer); controller.abort(); }
}
