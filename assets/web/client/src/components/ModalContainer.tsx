import { useCallback, useRef, useState } from "react";
import { useModal, type ModalItem } from "../context/ModalContext";

export default function ModalContainer() {
  const { modals, dockItems, closeModal, toggleMinimize, restoreModal, closeAllModals } = useModal();
  const activeModal = modals.find(m => !m.minimized);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragStartX = useRef(0);
  const dragOffsetX = useRef(0);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && activeModal) {
      closeModal(activeModal.id);
    }
  }, [activeModal, closeModal]);

  const handleEscape = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape" && activeModal) {
      closeModal(activeModal.id);
    }
  }, [activeModal, closeModal]);

  const onDragStart = useCallback((e: React.MouseEvent, id: string) => {
    setDragId(id);
    dragStartX.current = e.clientX;
    dragOffsetX.current = 0;
    const handleMove = (ev: MouseEvent) => {
      dragOffsetX.current = ev.clientX - dragStartX.current;
    };
    const handleUp = () => {
      setDragId(null);
      if (Math.abs(dragOffsetX.current) > 60) {
        closeModal(id);
      }
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [closeModal]);

  return (
    <>
      {activeModal && (
        <div
          className="modal-backdrop"
          onClick={handleBackdropClick}
          onKeyDown={handleEscape}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-window">
            <div className="modal-header">
              <span className="modal-title mono-label">{activeModal.title}</span>
              <div className="modal-header-actions">
                <button className="modal-header-btn" onClick={() => toggleMinimize(activeModal.id)} title="Minimize to dock">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button className="modal-header-btn" onClick={() => closeModal(activeModal.id)} title="Close">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div className="modal-body">
              {activeModal.content}
            </div>
          </div>
        </div>
      )}

      {dockItems.length > 0 && (
        <div className="modal-dock">
          <div className="modal-dock-items">
            {dockItems.map(item => (
              <div
                key={item.id}
                className={`modal-dock-item ${dragId === item.id ? "dragging" : ""}`}
                onMouseDown={e => onDragStart(e, item.id)}
                onClick={() => restoreModal(item.id)}
                style={dragId === item.id ? { transform: `translateX(${dragOffsetX.current}px)`, opacity: 0.6 } : undefined}
              >
                <span className="modal-dock-label">{item.title}</span>
                <button
                  className="modal-dock-close"
                  onClick={e => { e.stopPropagation(); closeModal(item.id); }}
                  title="Close"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="modal-dock-clear" onClick={closeAllModals} title="Close all">
            Clear all
          </button>
        </div>
      )}
    </>
  );
}
