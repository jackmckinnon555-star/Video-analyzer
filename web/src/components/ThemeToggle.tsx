import { useTheme, type ThemeChoice } from "../hooks/useTheme";

const LABELS: Record<ThemeChoice, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white p-0.5 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      {ORDER.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          aria-pressed={theme === t}
          className={`rounded px-2 py-1 transition ${
            theme === t
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
