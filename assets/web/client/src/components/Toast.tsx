import { useState, useCallback, createContext, useContext } from "react";

interface Toast { id: number; message: string; type: "success" | "error" | "info"; }

const ToastContext = createContext<{ toast: (msg: string, type?: "success" | "error" | "info") => void }>({ toast: () => {} });

export function useToast() { return useContext(ToastContext); }

let toastId = 0;

export function Toaster({ children }: { children?: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
