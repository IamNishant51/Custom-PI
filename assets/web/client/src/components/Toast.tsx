import { useState, useCallback, createContext, useContext, useEffect } from "react";

interface Toast { id: number; message: string; type: "success" | "error" | "info"; }

const ToastContext = createContext<{ toast: (msg: string, type?: "success" | "error" | "info") => void }>({ toast: () => {} });

export function useToast() { return useContext(ToastContext); }

let globalToastFn: ((msg: string, type: "success" | "error" | "info") => void) | null = null;

export function showToast(message: string, type: "success" | "error" | "info" = "error") {
  if (globalToastFn) globalToastFn(message, type);
}

let toastId = 0;

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  useEffect(() => {
    globalToastFn = addToast;
    return () => { globalToastFn = null; };
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="toast-container" role="alert" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
