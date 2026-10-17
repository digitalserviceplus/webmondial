export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  const url = new URL(configuredUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
