import { useState, useCallback, Suspense, lazy } from "react";
import { Routes, Route, Link } from "react-router-dom";
import PasswordGate from "./pages/PasswordGate";
import { getSitePassword, clearSitePassword } from "./lib/sitePassword";
import { AppLogo } from "./components/AppLogo";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";

// Route-split: dashboard + result aren't needed until after unlock.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const VideoResult = lazy(() => import("./pages/VideoResult"));
const PublicVideoResult = lazy(() => import("./pages/PublicVideoResult"));
const Compress = lazy(() => import("./pages/Compress"));

export default function App() {
  // Ensure the theme hook mounts at the app root so the html class is applied
  // even on the password-gate screen.
  useTheme();

  const [unlocked, setUnlocked] = useState<boolean>(() => !!getSitePassword());
  const onUnlock = useCallback(() => setUnlocked(true), []);
  const onLock = useCallback(() => {
    clearSitePassword();
    setUnlocked(false);
  }, []);

  // Public routes bypass the password gate:
  //   /p/:slug    read-only share pages
  //   /compress   browser compressor (100% client-side)
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isPublicRoute = path.startsWith("/p/") || path === "/compress" || path.startsWith("/compress/");

  if (isPublicRoute) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/p/:slug" element={<PublicVideoResult />} />
          <Route path="/compress" element={<Compress />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header unlocked={unlocked} onLock={onLock} />
      <main className="flex-1">
        {!unlocked ? (
          <PasswordGate onUnlock={onUnlock} />
        ) : (
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/video/:id" element={<VideoResult />} />
            </Routes>
          </Suspense>
        )}
      </main>
      <BuildFooter />
    </div>
  );
}

function Header({ unlocked, onLock }: { unlocked: boolean; onLock: () => void }) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
        <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <AppLogo size={28} />
          <span>Video Analyzer</span>
        </Link>
        <div className="flex items-center gap-2">
          {unlocked && (
            <a
              href="/compress"
              target="_blank"
              rel="noopener"
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              title="Compress a large video before uploading"
            >
              Compress
            </a>
          )}
          <ThemeToggle />
          {unlocked && (
            <button
              onClick={onLock}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Lock
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function RouteFallback() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-neutral-500">
      Loading…
    </div>
  );
}

const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ");
function BuildFooter() {
  return (
    <footer className="py-3 text-center text-[10px] text-neutral-400 dark:text-neutral-600">
      build {BUILD_ID}
    </footer>
  );
}
