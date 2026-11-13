/** Device secret handling (browser only). The key is generated here, stored in IndexedDB, and never logged. */

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** 32 random bytes as 64 hex characters. */
export function generateDeviceKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** SHA-256 of the key string, hex encoded: exactly what `hashDeviceKey` computes on the server. */
export async function hashDeviceKeyHex(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return hex(new Uint8Array(digest));
}
