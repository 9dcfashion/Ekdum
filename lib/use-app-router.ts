"use client";

import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/components/navigation-progress";

type AppRouter = ReturnType<typeof useRouter>;

function isNewUrl(href: string): boolean {
  try {
    const target = new URL(href, window.location.href);
    return target.origin === window.location.origin && (target.pathname !== window.location.pathname || target.search !== window.location.search);
  } catch {
    return false;
  }
}

/**
 * Drop-in for next/navigation's useRouter that also starts the top progress bar
 * for push/replace, so navigations made from code (after login, after saving)
 * give the same instant feedback as tapping a link.
 */
export function useAppRouter(): AppRouter {
  const router = useRouter();
  return {
    ...router,
    push: (href, options) => {
      if (isNewUrl(href)) startNavigationProgress();
      router.push(href, options);
    },
    replace: (href, options) => {
      if (isNewUrl(href)) startNavigationProgress();
      router.replace(href, options);
    },
  };
}
