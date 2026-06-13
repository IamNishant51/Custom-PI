import { useState, useEffect } from "react";

const CSS_VARS = [
  { key: "--bg", label: "Background", default: "#0a0a0a" },
  { key: "--surface", label: "Surface", default: "#1a1c20" },
  { key: "--text", label: "Text", default: "#ffffff" },
  { key: "--accent", label: "Accent", default: "#ff7a17" },
  { key: "--mute", label: "Muted", default: "#7d8187" },
  { key: "--hairline", label: "Hairline", default: "#212327" },
  { key: "--success", label: "Success", default: "#30d158" },
  { key: "--danger", label: "Danger", default: "#ff3b30" },
];

const FONTS = ["Inter, sans-serif", "Fira Code, monospace", "system-ui, sans-serif", "Georgia, serif"];
const SIZES = { small: "13px", normal: "14px", large: "16px" } as const;

function getRootVal(key: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(key).trim() || "";
}

function setRootVal(key: string, val: string) {
  document.documentElement.style.setProperty(key, val);
}

export default function ThemeEditorPanel() {
  const [colors, setColors] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("custom-theme");
    if (saved) { try { return JSON.parse(saved); } catch {} }
    const init: Record<string, string> = {};
    CSS_VARS.forEach(v => { init[v.key] = getRootVal(v.key) || v.default; });
    return init;
  });
  const [frosted, setFrosted] = useState(() => { const el = document.querySelector(".panel"); return el ? getComputedStyle(el).backdropFilter === "blur(12px)" : false; });
  const [fontFamily, setFontFamily] = useState(() => getRootVal("--font-sans") || FONTS[0]);
  const [fontSize, setFontSize] = useState<string>(() => getRootVal("--font-size-base") || SIZES.normal);
  const [jsonText, setJsonText] = useState("");

  const apply = (updated: Record<string, string>) => {
    CSS_VARS.forEach(v => setRootVal(v.key, updated[v.key]));
    localStorage.setItem("custom-theme", JSON.stringify(updated));
    setColors(updated);
    window.dispatchEvent(new CustomEvent("themechange"));
  };

  const updateColor = (key: string, val: string) => {
    const updated = { ...colors, [key]: val };
    apply(updated);
  };

  const toggleFrosted = () => {
    const p = document.querySelector(".panel") as HTMLElement | null;
    if (!p) return;
    if (frosted) {
      p.style.backdropFilter = "none";
      p.style.background = "var(--surface)";
    } else {
      p.style.backdropFilter = "blur(12px)";
      p.style.background = "rgba(26, 28, 32, 0.6)";
    }
    setFrosted(!frosted);
  };

  const changeFont = (family: string) => {
    setFontFamily(family);
    setRootVal("--font-sans", family);
  };

  const changeSize = (size: string) => {
    setFontSize(size);
    setRootVal("--font-size-base", size);
    document.documentElement.style.fontSize = size;
  };

  const exportTheme = () => {
    setJsonText(JSON.stringify(colors, null, 2));
  };

  const importTheme = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const valid = CSS_VARS.every(v => typeof parsed[v.key] === "string");
      if (!valid) { alert("Invalid theme JSON: missing keys"); return; }
      apply(parsed);
    } catch { alert("Invalid JSON"); }
  };

  const resetToDefaults = () => {
    const defaults: Record<string, string> = {};
    CSS_VARS.forEach(v => { defaults[v.key] = v.default; });
    apply(defaults);
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Theme Editor</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--mute)", textTransform: "uppercase", letterSpacing: 1 }}>Colors</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {CSS_VARS.map(v => (
              <div key={v.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="color" value={colors[v.key] || v.default} onChange={e => updateColor(v.key, e.target.value)}
                  style={{ width: 32, height: 32, border: "1px solid var(--hairline)", borderRadius: 4, background: "none", cursor: "pointer", padding: 0 }} />
                <div style={{ flex: 1, fontSize: 12 }}>
                  <div>{v.label}</div>
                  <div style={{ color: "var(--mute)", fontSize: 10, fontFamily: "monospace" }}>{colors[v.key]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={frosted} onChange={toggleFrosted} />
            Frosted Glass Effect (backdrop-filter: blur)
          </label>
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--mute)", textTransform: "uppercase", letterSpacing: 1 }}>Font</div>
          <select className="input" value={fontFamily} onChange={e => changeFont(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(SIZES).map(([label, val]) => (
              <button key={label} className={`btn ${fontSize === val ? "btn-primary" : ""}`} onClick={() => changeSize(val)}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn" onClick={exportTheme}>Export JSON</button>
            <button className="btn" onClick={importTheme}>Import JSON</button>
            <button className="btn" onClick={resetToDefaults} style={{ color: "var(--danger)" }}>Reset</button>
          </div>
          <textarea className="input" placeholder="Paste theme JSON here to import" value={jsonText} onChange={e => setJsonText(e.target.value)} rows={4} style={{ width: "100%", fontSize: 11, fontFamily: "monospace" }} />
        </div>
      </div>
    </div>
  );
}
