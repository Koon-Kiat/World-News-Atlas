import { isIP } from "node:net";

function validClientIp(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  if (!isIP(candidate)) return null;
  return isIP(candidate) === 6 ? new URL(`http://[${candidate}]/`).hostname : candidate;
}

export function clientKey(request: Request, trustedCloudflare = false): string {
  if (!trustedCloudflare) return "anonymous";
  const connecting = validClientIp(request.headers.get("cf-connecting-ip"));
  return connecting ?? "anonymous";
}
