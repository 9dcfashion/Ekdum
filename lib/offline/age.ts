/** "just now", "5 min ago", "3 h ago", "2 days ago" for the catalog age and last sync time. */
export function describeAge(at: number | null | undefined, now: number): string {
  if (!at) return "never";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export const CATALOG_REFRESH_MINUTES = 10;
/** Past this, prices on the device are old enough to tell the cashier plainly. */
export const CATALOG_STALE_MS = 24 * 60 * 60_000;
