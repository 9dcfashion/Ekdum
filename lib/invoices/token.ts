/** Public invoice tokens are 64 hex characters today (43-char base64url is also accepted). */
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Cheap shape check done before any database query, so junk never reaches Postgres. */
export function isPublicTokenShape(token: string | null | undefined): token is string {
  return typeof token === "string" && PUBLIC_TOKEN_PATTERN.test(token);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
