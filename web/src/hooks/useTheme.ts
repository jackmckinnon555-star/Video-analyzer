import { useEffect, useState, useCallback } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "va.theme";

function currentSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const dark = choice === "dark" || (choice === "system" && currentSystemPrefersDark());
  root.classList.toggle("dark", dark);
  root.dataset.theme = choice;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as ThemeChoice) || "system";
  });

  useEffect(() => {
    applyTheme(theme);
    if (theme === "system") {
      // React to OS changes while "system" is active.
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
