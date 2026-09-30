export function securityHeaders(publicUrl) {
  let websocket = "";
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Invalid PUBLIC_URL");
    websocket = url.origin.replace(/^http/, "ws");
  }
  return {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'" + (websocket ? " " + websocket : "") + "; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}
