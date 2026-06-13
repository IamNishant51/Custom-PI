import { useState, useEffect, useCallback } from "react";

interface DocTab {
  id: string; name: string; content: string; dirty: boolean;
}

interface DocLibraryEntry {
  id: string; name: string; content: string; savedAt: number;
}

const DEFAULT_CONTENT = "# Untitled\n\nStart writing here...\n";

const SYNTAX_LANGUAGES = ["javascript", "typescript", "python", "html", "css", "json", "markdown", "bash"];

export default function DocumentEditorPanel() {
  const [tabs, setTabs] = useState<DocTab[]>([
    { id: "doc_1", name: "untitled.md", content: DEFAULT_CONTENT, dirty: false },
  ]);
  const [activeId, setActiveId] = useState("doc_1");
  const [library, setLibrary] = useState<DocLibraryEntry[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  useEffect(() => {
    try { const saved = localStorage.getItem("doc-library"); if (saved) setLibrary(JSON.parse(saved)); } catch {}
  }, []);

  const saveLibrary = (docs: DocLibraryEntry[]) => {
    setLibrary(docs);
    localStorage.setItem("doc-library", JSON.stringify(docs));
  };

  const active = tabs.find(t => t.id === activeId) || tabs[0];

  const updateContent = useCallback((content: string) => {
    setTabs(prev => prev.map(t => t.id === activeId ? { ...t, content, dirty: true } : t));
  }, [activeId]);

  const addTab = () => {
    const id = `doc_${Date.now()}`;
    setTabs(prev => [...prev, { id, name: `untitled_${prev.length + 1}.md`, content: DEFAULT_CONTENT, dirty: false }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const filtered = prev.filter(t => t.id !== id);
      if (filtered.length === 0) {
        const newId = `doc_${Date.now()}`;
        return [{ id: newId, name: "untitled.md", content: DEFAULT_CONTENT, dirty: false }];
      }
      if (id === activeId) {
        const nextIdx = Math.min(idx, filtered.length - 1);
        setActiveId(filtered[nextIdx].id);
      }
      return filtered;
    });
  };

  const renameTab = (id: string, name: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, name, dirty: true } : t));
  };

  const saveToLibrary = () => {
    const entry: DocLibraryEntry = { id: active.id, name: active.name, content: active.content, savedAt: Date.now() };
    const existing = library.findIndex(e => e.id === active.id);
    if (existing >= 0) {
      const updated = [...library];
      updated[existing] = entry;
      saveLibrary(updated);
    } else {
      saveLibrary([...library, entry]);
    }
    setTabs(prev => prev.map(t => t.id === activeId ? { ...t, dirty: false } : t));
  };

  const openFromLibrary = (entry: DocLibraryEntry) => {
    if (!tabs.find(t => t.id === entry.id)) {
      setTabs(prev => [...prev, { id: entry.id, name: entry.name, content: entry.content, dirty: false }]);
    }
    setActiveId(entry.id);
    setShowLibrary(false);
  };

  const deleteFromLibrary = (id: string) => {
    saveLibrary(library.filter(e => e.id !== id));
  };

  const downloadCurrent = () => {
    const blob = new Blob([active.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = active.name;
    a.click(); URL.revokeObjectURL(url);
  };

  const aiEdit = async () => {
    if (!aiPrompt.trim()) return;
    const text = active.content;
    try {
      const r = await fetch("/api/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "", messages: [{ role: "system", content: `Edit the following document according to this instruction: "${aiPrompt}". Return ONLY the edited text, no explanations.` }, { role: "user", content: text }], stream: false }),
      });
      const d = await r.json();
      const edited = d.choices?.[0]?.message?.content || d.content;
      if (edited) updateContent(edited);
    } catch {}
  };

  const highlightSyntax = (code: string, lang: string) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (lang === "javascript" || lang === "typescript") {
      return escaped.replace(/(\/\/.*)/g, '<span style="color:#6a9955">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ce9178">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#ce9178">$1</span>')
        .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|new|this|typeof|instanceof)\b/g, '<span style="color:#569cd6">$1</span>');
    }
    if (lang === "python") {
      return escaped.replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ce9178">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#ce9178">$1</span>')
        .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|async|await|print|len|range|self|None|True|False)\b/g, '<span style="color:#569cd6">$1</span>');
    }
    return escaped;
  };

  return (
    <div className="panel" style={{ padding: 0, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--hairline)", background: "var(--surface)", overflowX: "auto" }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setActiveId(t.id)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", cursor: "pointer", borderRight: "1px solid var(--hairline)", background: t.id === activeId ? "var(--bg)" : "transparent", borderBottom: t.id === activeId ? "2px solid var(--accent)" : "2px solid transparent", whiteSpace: "nowrap", fontSize: 13 }}>
            <input className="input" value={t.name} onChange={e => renameTab(t.id, e.target.value)}
              style={{ border: "none", background: "transparent", color: "var(--text)", width: Math.max(t.name.length * 7.5, 60), padding: 0, fontSize: 13, outline: "none" }}
              onClick={e => e.stopPropagation()} />
            {t.dirty && <span style={{ color: "var(--mute)", fontSize: 10 }}>●</span>}
            <span onClick={e => { e.stopPropagation(); closeTab(t.id); }} style={{ cursor: "pointer", color: "var(--mute)", fontSize: 14, lineHeight: 1 }}>×</span>
          </div>
        ))}
        <button className="btn" onClick={addTab} style={{ border: "none", background: "transparent", padding: "6px 12px", cursor: "pointer", color: "var(--mute)", fontSize: 16 }}>+</button>
        <button className="btn" onClick={() => setShowLibrary(!showLibrary)} style={{ border: "none", background: "transparent", padding: "6px 12px", cursor: "pointer", color: "var(--mute)", fontSize: 12 }}>{showLibrary ? "Editor" : "Library"}</button>
      </div>
      {showLibrary ? (
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          <h3 style={{ margin: "0 0 12px" }}>Document Library</h3>
          {library.length === 0 ? (
            <div style={{ color: "var(--mute)", textAlign: "center", padding: 32 }}>No saved documents.</div>
          ) : (
            library.map(entry => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", border: "1px solid var(--hairline)", borderRadius: 6, marginBottom: 4 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</div>
                  <div style={{ fontSize: 11, color: "var(--mute)" }}>{new Date(entry.savedAt).toLocaleString()} · {entry.content.length} chars</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn" onClick={() => openFromLibrary(entry)} style={{ fontSize: 11, padding: "2px 8px" }}>Open</button>
                  <button className="btn" onClick={() => deleteFromLibrary(entry.id)} style={{ fontSize: 11, padding: "2px 8px" }}>Del</button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", gap: 0 }}>
          <textarea value={active.content} onChange={e => updateContent(e.target.value)}
            style={{ flex: 1, padding: 16, border: "none", background: "var(--bg)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-mono, monospace)", lineHeight: 1.6, resize: "none", outline: "none" }} />
          <div style={{ flex: 1, padding: 16, overflowY: "auto", borderLeft: "1px solid var(--hairline)", background: "var(--surface)", fontSize: 14, lineHeight: 1.6 }}>
            {renderMarkdown(active.content, highlightSyntax)}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", borderTop: "1px solid var(--hairline)", fontSize: 11, color: "var(--mute)", alignItems: "center" }}>
        <span>{active.name} — {active.content.length} chars</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" placeholder="AI: change to..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
            style={{ width: 160, padding: "2px 8px", fontSize: 11, border: "1px solid var(--hairline)", borderRadius: 4, background: "var(--surface)", color: "var(--text)" }} />
          <button className="btn" onClick={aiEdit} style={{ fontSize: 11, padding: "2px 8px" }}>AI Edit</button>
          <button className="btn" onClick={saveToLibrary} style={{ fontSize: 11, padding: "2px 8px" }}>Save</button>
          <button className="btn" onClick={downloadCurrent} style={{ fontSize: 11, padding: "2px 8px" }}>Download</button>
        </div>
      </div>
    </div>
  );
}

function renderMarkdown(md: string, highlight: (code: string, lang: string) => string) {
  const html = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/\n/g, "<br/>");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
