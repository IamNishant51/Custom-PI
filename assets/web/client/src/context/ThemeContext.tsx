import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { getTheme, getAllThemes, applyTheme, type ThemeColors } from "../themes";

interface ThemeContextValue {
  currentTheme: ThemeColors;
  themeName: string;
  setTheme: (name: string) => void;
  availableThemes: Record<string, ThemeColors>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadTheme(): string {
  try {
    return localStorage.getItem("custom-pi-theme") || "dark";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<string>(loadTheme);

  const setTheme = useCallback((name: string) => {
    const t = getTheme(name);
    applyTheme(t);
    setThemeName(name);
  }, []);

  useEffect(() => {
    const t = getTheme(themeName);
    applyTheme(t);
  }, [themeName]);

  const value: ThemeContextValue = {
    currentTheme: getTheme(themeName),
    themeName,
    setTheme,
    availableThemes: getAllThemes(),
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
