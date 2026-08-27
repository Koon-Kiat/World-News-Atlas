import { isIP } from "node:net";

function validClientIp(value: string | null, forwarded = false): string | null {
  const candidate = (forwarded ? value?.split(",")[0] : value)?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

export function clientKey(request: Request): string {
  const connecting = validClientIp(request.headers.get("cf-connecting-ip"));
  const real = validClientIp(request.headers.get("x-real-ip"));
  const forwarded = validClientIp(request.headers.get("x-forwarded-for"), true);
  return connecting ?? real ?? forwarded ?? "anonymous";
}
