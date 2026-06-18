import { useCallback } from "react";

interface UndoEntry {
  type: string;
  entityType: string;
  entityId?: string;
  description: string;
  data?: unknown;
  inverseData?: unknown;
}

export default function useUndo() {
  const record = useCallback(async (entry: UndoEntry) => {
    try {
      await fetch("/api/undo/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entry.type,
          entityType: entry.entityType,
          entityId: entry.entityId,
          description: entry.description,
          data: entry.data,
          inverseData: entry.inverseData,
        }),
      });
    } catch {}
  }, []);

  return { record };
}
