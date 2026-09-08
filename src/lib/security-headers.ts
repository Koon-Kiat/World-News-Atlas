export function contentSecurityPolicy(nonce?: string, development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // React map transforms, theme colorScheme, and image fallbacks still set styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}
