import { useState, useEffect, useCallback, useRef } from "react";

interface DocTab {
  id: string; name: string; content: string; dirty: boolean;
}

interface DocLibraryEntry {
  id: string; name: string; content: string; savedAt: number;
}

const DEFAULT_CONTENT = "# Untitled\n\nStart writing here...\n";

export default function DocumentEditorPanel() {
  const [tabs, setTabs] = useState<DocTab[]>([
    { id: "doc_1", name: "untitled.md", content: DEFAULT_CONTENT, dirty: false },
  ]);
  const [activeId, setActiveId] = useState("doc_1");
  const [library, setLibrary] = useState<DocLibraryEntry[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem("doc-library"); if (saved) setLibrary(JSON.parse(saved)); } catch {}
  }, []);

  const showToast = (text: string, type: "success" | "error") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

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
        setActiveId(filtered[Math.min(idx, filtered.length - 1)].id);
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
    showToast("Document saved", "success");
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
    showToast("Document deleted", "success");
  };

  const downloadCurrent = () => {
    const blob = new Blob([active.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = active.name;
    a.click(); URL.revokeObjectURL(url);
  };

  const isDefaultContent = (c: string) => !c.trim() || c.trim() === "Start writing here..." || c === DEFAULT_CONTENT;

  const aiEdit = async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    const text = active.content;
    const isGenerate = isDefaultContent(text);
    setAiLoading(true);
    setAiError("");
    try {
      const topic = aiPrompt.replace(/[""]/g, "");
      const systemMsg = isGenerate
        ? `Write a Markdown document about: ${topic}

Use # headings, **bold**, \`code\`, \`\`\`code blocks\`\`\`, | tables |, - lists.
Return ONLY the Markdown. No thinking, no planning, no commentary.`
        : `Edit this document: ${topic}

Return ONLY the edited document. No thinking, no planning, no commentary.`;

      const r = await fetch("/api/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "", messages: [
            { role: "system", content: systemMsg },
            ...(isGenerate ? [] : [{ role: "user", content: text }]),
          ], stream: false, max_tokens: 1024,
        }),
      });
      const d = await r.json();
      if (d.error) { setAiError(d.error); showToast(`AI failed: ${d.error}`, "error"); return; }
      const edited = d.choices?.[0]?.message?.content || d.content;
      if (edited) {
        const cleaned = edited.replace(/^```[\w]*\n?|```$/g, "").trim();
        updateContent(cleaned);
        showToast(isGenerate ? "Document generated" : "AI edit applied", "success");
        setAiPrompt("");
      }
    } catch {
      setAiError("AI server unreachable — check LM Studio is running");
      showToast("AI server unreachable", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const renderMarkdown = (md: string) => {
    const escaped = md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let html = escaped
      .replace(/^### (.*$)/gm, "<h3>$1</h3>")
      .replace(/^## (.*$)/gm, "<h2>$1</h2>")
      .replace(/^# (.*$)/gm, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre style="background:var(--surface-soft);border-radius:6px;padding:12px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${syntaxHighlight(code, lang)}</code></pre>`)
      .replace(/`([^`]+)`/g, "<code style='background:var(--surface-soft);padding:2px 6px;border-radius:3px;font-size:13px'>$1</code>")
      .replace(/^- (.*$)/gm, "<li style='margin:2px 0'>$1</li>")
      .replace(/^(\d+)\. (.*$)/gm, "<li style='margin:2px 0'>$1. $2</li>")
      .replace(/\n\n/g, "</p><p style='margin:8px 0'>")
      .replace(/\n/g, "<br/>");
    html = "<p style='margin:8px 0'>" + html + "</p>";
    return <div ref={previewRef} dangerouslySetInnerHTML={{ __html: html }} style={{ animation: "docFadeIn 0.15s ease" }} />;
  };

  const syntaxHighlight = (code: string, lang: string) => {
    const e = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (["javascript", "typescript", "js", "ts"].includes(lang)) {
      return e
        .replace(/(\/\/.*)/g, '<span style="color:#6a9955">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ce9178">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#ce9178">$1</span>')
        .replace(/`(?:[^`\\]|\\.)*`/g, '<span style="color:#ce9178">$1</span>')
        .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|async|await|class|new|this|typeof|instanceof|try|catch|throw|finally|yield|delete|in|of|with|get|set|static|extends|super|void)\b/g, '<span style="color:#569cd6">$1</span>')
        .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, '<span style="color:#569cd6">$1</span>');
    }
    if (["python", "py"].includes(lang)) {
      return e
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ce9178">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#ce9178">$1</span>')
        .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|async|await|print|len|range|self|None|True|False|raise|pass|break|continue|lambda|yield|global|nonlocal|assert|del|not|and|or|is|in)\b/g, '<span style="color:#569cd6">$1</span>');
    }
    if (lang === "json") {
      return e
        .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#9cdcfe">$1</span>:')
        .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#ce9178">$1</span>')
        .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#b5cea8">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span style="color:#569cd6">$1</span>');
    }
    if (["html", "xml"].includes(lang)) {
      return e
        .replace(/(&lt;\/?[\w-]+)/g, '<span style="color:#569cd6">$1</span>')
        .replace(/(["'])(?:(?!\1).)*?\1/g, '<span style="color:#ce9178">$1</span>');
    }
    if (lang === "bash" || lang === "sh") {
      return e
        .replace(/(#.*)/g, '<span style="color:#6a9955">$1</span>')
        .replace(/\b(cd|ls|cat|grep|find|npm|node|mkdir|rm|cp|mv|touch|chmod|echo|export|source|sudo|apt|brew|pip|git|docker|curl|wget)\b/g, '<span style="color:#569cd6">$1</span>');
    }
    if (lang === "css") {
      return e
        .replace(/([\w-]+)\s*:/g, '<span style="color:#9cdcfe">$1</span>:')
        .replace(/(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/g, '<span style="color:#ce9178">$1</span>')
        .replace(/\.([\w-]+)/g, '<span style="color:#d7ba7d">.$1</span>');
    }
    return e;
  };

  return (
    <div className="panel" style={{ padding: 0, display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <style>{`
        @keyframes docFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes docSlideIn { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 200px; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes pulse-dot { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        .doc-shimmer { background: linear-gradient(90deg, var(--surface-soft) 25%, var(--surface-card) 50%, var(--surface-soft) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease infinite; }
        .doc-pulse-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse-dot 1.4s ease infinite both; }
        .doc-pulse-dot:nth-child(2) { animation-delay: 0.16s; }
        .doc-pulse-dot:nth-child(3) { animation-delay: 0.32s; }
        .doc-tab { display: flex; align-items: center; gap: 4px; padding: 7px 10px; cursor: pointer; border-right: 1px solid var(--hairline); font-size: 12px; white-space: nowrap; transition: background 0.1s, border-bottom-color 0.1s; border-bottom: 2px solid transparent; font-family: var(--font-mono); color: var(--mute); flex-shrink: 0; }
        .doc-tab:hover { background: var(--surface-soft); }
        .doc-tab.active { background: var(--bg); color: var(--ink); border-bottom-color: var(--accent); }
        .doc-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; font-size: 12px; line-height: 1; color: var(--mute); opacity: 0; transition: all 0.1s; }
        .doc-tab:hover .doc-tab-close { opacity: 1; }
        .doc-tab-close:hover { background: var(--surface-soft); color: var(--ink); }
        .preview-content h1 { font-size: 22px; font-weight: 600; margin: 16px 0 8px; color: var(--ink); border-bottom: 1px solid var(--hairline); padding-bottom: 6px; }
        .preview-content h2 { font-size: 18px; font-weight: 600; margin: 14px 0 6px; color: var(--ink); }
        .preview-content h3 { font-size: 15px; font-weight: 600; margin: 12px 0 4px; color: var(--ink); }
        .preview-content p { margin: 6px 0; line-height: 1.7; }
        .preview-content li { margin: 2px 0; line-height: 1.6; }
        .preview-content strong { color: var(--ink); font-weight: 600; }
        .preview-content code { background: var(--surface-soft); padding: 2px 6px; border-radius: 3px; font-size: 13px; font-family: var(--font-mono); }
        .preview-content pre { margin: 12px 0; }
        .preview-content pre code { background: none; padding: 0; }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: toast.type === "success" ? "var(--success)" : "var(--danger)",
          color: "#fff", padding: "8px 16px", borderRadius: 8,
          fontFamily: "var(--font-mono)", fontSize: 12,
          animation: "docFadeIn 0.15s ease",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>{toast.text}</div>
      )}

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 16px", borderBottom: "1px solid var(--hairline)",
      }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Documents</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="btn btn-ghost"
            onClick={() => setShowLibrary(!showLibrary)}
            style={{ fontSize: 11, height: 28, padding: "0 10px" }}
          >
            {showLibrary ? "Editor" : "Library"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setShowAiPanel(!showAiPanel)}
            style={{ fontSize: 11, height: 28, padding: "0 10px" }}
          >
            AI ✦
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--hairline)",
        background: "var(--surface)", overflowX: "auto", alignItems: "stretch",
      }}>
        {tabs.map(t => (
          <div
            key={t.id}
            className={`doc-tab ${t.id === activeId ? "active" : ""}`}
            onClick={() => setActiveId(t.id)}
          >
            <input
              className="input"
              value={t.name}
              onChange={e => renameTab(t.id, e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{
                border: "none", background: "transparent", color: "var(--text)",
                width: Math.max(t.name.length * 7.5, 50), padding: 0, fontSize: 12,
                outline: "none", fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            />
            {t.dirty && <span style={{ color: "var(--accent)", fontSize: 8 }}>●</span>}
            <span
              className="doc-tab-close"
              onClick={e => { e.stopPropagation(); closeTab(t.id); }}
            >×</span>
          </div>
        ))}
        <button
          className="btn"
          onClick={addTab}
          style={{
            border: "none", background: "transparent", padding: "7px 12px",
            cursor: "pointer", color: "var(--mute)", fontSize: 15, flexShrink: 0,
            fontFamily: "var(--font-mono)",
          }}
          title="New tab"
        >+</button>
      </div>

      {showLibrary ? (
        /* Library view */
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--mute)",
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 12,
          }}>
            Document Library ({library.length})
          </div>
          {library.length === 0 ? (
            <div style={{
              textAlign: "center", color: "var(--mute)", padding: 40,
              fontFamily: "var(--font-mono)", fontSize: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📄</div>
              No saved documents yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {library.map(entry => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", border: "1px solid var(--hairline)", borderRadius: 8,
                    background: "var(--surface-card)",
                    transition: "border-color 0.12s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--hairline-strong)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--hairline)"}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13, color: "var(--ink)" }}>{entry.name}</div>
                    <div style={{ fontSize: 11, color: "var(--mute)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      {new Date(entry.savedAt).toLocaleString()} · {entry.content.length} chars
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost" onClick={() => openFromLibrary(entry)} style={{ fontSize: 11, padding: "2px 10px", height: 28 }}>Open</button>
                    <button className="btn btn-ghost" onClick={() => deleteFromLibrary(entry.id)} style={{ fontSize: 11, padding: "2px 10px", height: 28, color: "var(--danger)" }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Editor split view */
        <div style={{ flex: 1, display: "flex", gap: 0, minHeight: 0 }}>
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
            borderRight: showPreview ? "1px solid var(--hairline)" : "none",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 12px", borderBottom: "1px solid var(--hairline)",
              background: "var(--surface)", fontSize: 10, fontFamily: "var(--font-mono)",
              color: "var(--mute)", flexShrink: 0,
            }}>
              <span>Source</span>
              <span>{active.content.length} chars</span>
            </div>
            <textarea
              ref={textareaRef}
              value={active.content}
              onChange={e => updateContent(e.target.value)}
              style={{
                flex: 1, padding: 16, border: "none", background: "var(--bg)",
                color: "var(--body)", fontSize: 14, fontFamily: "var(--font-mono)",
                lineHeight: 1.7, resize: "none", outline: "none", minHeight: 150,
              }}
              spellCheck={false}
            />
          </div>
          {showPreview && (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "4px 12px", borderBottom: "1px solid var(--hairline)",
                background: "var(--surface)", fontSize: 10, fontFamily: "var(--font-mono)",
                color: "var(--mute)", flexShrink: 0,
              }}>
                <span>Preview</span>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowPreview(false)}
                  style={{ fontSize: 9, padding: "2px 6px", height: "auto" }}
                >Hide</button>
              </div>
              <div
                className="preview-content"
                style={{
                  flex: 1, padding: "12px 16px", overflowY: "auto",
                  background: "var(--surface)", fontSize: 14, lineHeight: 1.7,
                  color: "var(--body)",
                }}
              >
                {active.content.trim() ? renderMarkdown(active.content) : (
                  <span style={{ color: "var(--mute)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Empty document — start writing...</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom bar with AI panel and actions */}
      <div style={{
        borderTop: "1px solid var(--hairline)", background: "var(--surface-card)",
      }}>
        {showAiPanel && (
          <div style={{
            padding: "8px 12px", borderBottom: "1px solid var(--hairline)",
            animation: "docSlideIn 0.15s ease",
            background: "var(--surface)",
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                placeholder='Type a topic to generate or "rewrite this to..."'
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) aiEdit(); if (e.key === "Escape") setShowAiPanel(false); }}
                style={{
                  flex: 1, fontSize: 13, height: 34, color: "var(--body)",
                  border: aiError ? "1px solid var(--danger)" : "1px solid var(--hairline)",
                  background: "var(--surface-soft)",
                }}
                disabled={aiLoading}
              />
              <button
                className={`btn ${aiLoading ? "" : "btn-primary"}`}
                onClick={aiEdit}
                disabled={aiLoading || !aiPrompt.trim()}
                style={{
                  fontSize: 12, height: 34, padding: "0 14px", minWidth: 80,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                {aiLoading ? (
                  <>
                    <span className="doc-pulse-dot" />
                    <span className="doc-pulse-dot" />
                    <span className="doc-pulse-dot" />
                  </>
                ) : "AI Edit"}
              </button>
            </div>
            {aiError && (
              <div style={{
                fontSize: 11, color: "var(--danger)", marginTop: 6,
                fontFamily: "var(--font-mono)",
              }}>
                {aiError}
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--mute)", fontFamily: "var(--font-mono)", marginTop: 6 }}>
              {aiLoading ? "Editing document..." : "Ctrl+Enter to apply · Escape to close"}
            </div>
          </div>
        )}

        {showAiPanel && aiLoading && (
          <div style={{ height: 3, background: "var(--surface-soft)", position: "relative" }}>
            <div className="doc-shimmer" style={{ height: "100%", width: "100%", borderRadius: 2 }} />
          </div>
        )}

        {/* Status bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 12px", fontSize: 11, color: "var(--mute)",
          fontFamily: "var(--font-mono)",
        }}>
          <span>{active.name} · {active.content.length} chars{active.dirty ? " · unsaved" : ""}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!showAiPanel && (
              <button
                className="btn btn-ghost"
                onClick={() => setShowAiPanel(true)}
                style={{ fontSize: 10, padding: "2px 8px", height: 24 }}
              >
                AI Edit ✦
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => setShowPreview(!showPreview)}
              style={{ fontSize: 10, padding: "2px 8px", height: 24 }}
            >
              {showPreview ? "Hide Preview" : "Preview"}
            </button>
            <button className="btn btn-ghost" onClick={saveToLibrary} style={{ fontSize: 10, padding: "2px 8px", height: 24 }}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={downloadCurrent} style={{ fontSize: 10, padding: "2px 8px", height: 24 }}>
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
