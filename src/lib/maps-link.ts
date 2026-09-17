// Deliberately matches the database allowlist. No URL shortening or fetching.
export function mapsLink(value: string | null | undefined): string | null {
  const link = value?.trim()
  if (!link || link.length > 2048 || /[\s\\]/.test(link)) return null
  return /^https:\/\/((www\.)?google\.com\/maps([/?#].*)?|maps\.google\.com\/[^\s]*|maps\.app\.goo\.gl\/[A-Za-z0-9_-]+([?#].*)?|goo\.gl\/maps\/[A-Za-z0-9_-]+([?#].*)?)$/.test(link) ? link : null
}
