/** Public (browser-safe) environment. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
};

/** True once the Supabase project keys are in .env.local. */
export function isSupabaseConfigured(): boolean {
  return /^https?:\/\//.test(env.supabaseUrl) && env.supabaseAnonKey.length > 20;
}

/** Absolute URL for a path, always based on NEXT_PUBLIC_APP_URL (never a hardcoded domain). */
export function absoluteUrl(path: string): string {
  return `${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
