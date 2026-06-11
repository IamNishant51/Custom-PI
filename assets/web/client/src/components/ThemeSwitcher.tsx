import { useTheme } from "../context/ThemeContext";

export default function ThemeSwitcher() {
  const { currentTheme, setTheme, availableThemes } = useTheme();

  return (
    <div className="theme-switcher">
      {Object.entries(availableThemes).map(([key, theme]) => (
        <button
          key={key}
          className={`theme-option ${currentTheme.name === key ? "active" : ""}`}
          onClick={() => setTheme(key)}
          title={theme.label}
        >
          <span className="theme-preview" style={{
            background: `linear-gradient(135deg, ${theme.accent}, ${theme.canvas})`,
            border: `1px solid ${theme.hairline}`,
          }} />
          <span className="theme-label">{theme.label}</span>
        </button>
      ))}
    </div>
  );
}
