import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
// The app already renders these documents on request in Vinext. API and hashed
// asset caches retain their own policies; they do not require a document nonce.
export const config = { matcher: ["/", "/country", "/compare", "/saved", "/settings"] };
