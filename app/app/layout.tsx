// Everything under /app depends on the signed-in user's cookies: never prerender it.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
