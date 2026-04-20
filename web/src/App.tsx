import { useState, useCallback } from "react";
import { Routes, Route, Link } from "react-router-dom";
import PasswordGate from "./pages/PasswordGate";
import Dashboard from "./pages/Dashboard";
import VideoResult from "./pages/VideoResult";
import { getSitePassword, clearSitePassword } from "./lib/sitePassword";

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean>(() => !!getSitePassword());
  const onUnlock = useCallback(() => setUnlocked(true), []);
  const onLock = useCallback(() => {
    clearSitePassword();
    setUnlocked(false);
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <Header unlocked={unlocked} onLock={onLock} />
      <main className="flex-1">
        {!unlocked ? (
          <PasswordGate onUnlock={onUnlock} />
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/video/:id" element={<VideoResult />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

function Header({ unlocked, onLock }: { unlocked: boolean; onLock: () => void }) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Video Analyzer
        </Link>
        {unlocked && (
          <button
            onClick={onLock}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Lock
          </button>
        )}
      </div>
    </header>
  );
}
