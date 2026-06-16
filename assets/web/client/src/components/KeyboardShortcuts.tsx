import { useEffect } from "react";

interface Shortcut {
  key: string;
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: "?", label: "Toggle this help overlay" },
  { key: "Ctrl+K", label: "Search sidebar views" },
  { key: "Ctrl+Shift+C", label: "Focus chat input" },
  { key: "Escape", label: "Close overlay / Cancel" },
];

export default function KeyboardShortcuts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="shortcuts-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="shortcuts-header">
          Keyboard Shortcuts
          <button className="shortcuts-close" onClick={onClose} aria-label="Close keyboard shortcuts">
            ✕
          </button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="shortcut-row">
              <kbd className="shortcut-key">{s.key}</kbd>
              <span className="shortcut-desc">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
