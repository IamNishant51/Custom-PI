import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface ModalItem {
  id: string;
  title: string;
  content: ReactNode;
  minimized: boolean;
}

interface ModalContextValue {
  modals: ModalItem[];
  openModal: (id: string, title: string, content: ReactNode) => void;
  closeModal: (id: string) => void;
  toggleMinimize: (id: string) => void;
  restoreModal: (id: string) => void;
  closeAllModals: () => void;
  isOpen: (id: string) => boolean;
  dockItems: ModalItem[];
}

const ModalContext = createContext<ModalContextValue | null>(null);

let modalIdCounter = 0;
export function nextModalId(prefix = "modal") {
  return `${prefix}_${++modalIdCounter}`;
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modals, setModals] = useState<ModalItem[]>([]);

  const openModal = useCallback((id: string, title: string, content: ReactNode) => {
    setModals(prev => {
      const existing = prev.find(m => m.id === id);
      if (existing) {
        if (existing.minimized) {
          return prev.map(m => m.id === id ? { ...m, minimized: false } : m);
        }
        return prev;
      }
      return [...prev, { id, title, content, minimized: false }];
    });
  }, []);

  const closeModal = useCallback((id: string) => {
    setModals(prev => prev.filter(m => m.id !== id));
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setModals(prev => prev.map(m => m.id === id ? { ...m, minimized: !m.minimized } : m));
  }, []);

  const restoreModal = useCallback((id: string) => {
    setModals(prev => prev.map(m => m.id === id ? { ...m, minimized: false } : m));
  }, []);

  const closeAllModals = useCallback(() => {
    setModals([]);
  }, []);

  const isOpen = useCallback((id: string) => {
    return modals.some(m => m.id === id);
  }, [modals]);

  const dockItems = modals.filter(m => m.minimized);

  return (
    <ModalContext.Provider value={{ modals, openModal, closeModal, toggleMinimize, restoreModal, closeAllModals, isOpen, dockItems }}>
      {children}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within ModalProvider");
  return ctx;
}
