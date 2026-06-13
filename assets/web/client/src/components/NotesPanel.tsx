import { useState, useEffect } from "react";
import { useToast } from "./Toast";

interface Note {
  id: string; title: string; content: string; color: string;
  pinned: number; archived: number; tags: string[];
  created_at: number; updated_at: number;
}

interface Task {
  id: string; title: string; done: number; status: string;
  priority: string; due_date: number | null; note_id: string;
  created_at: number; updated_at: number;
}

export default function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<"notes" | "tasks">("notes");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const { toast } = useToast();

  const loadNotes = async () => {
    try {
      const res = await fetch("/api/notes");
      const d = await res.json();
      setNotes(d.notes || []);
    } catch { toast("Failed to load notes", "error"); }
  };

  const loadTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const d = await res.json();
      setTasks(d.tasks || []);
    } catch { toast("Failed to load tasks", "error"); }
  };

  useEffect(() => { loadNotes(); loadTasks(); }, []);

  const createNote = async () => {
    if (!newNoteTitle.trim()) return;
    try {
      await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newNoteTitle }) });
      setNewNoteTitle("");
      loadNotes();
      toast("Note created", "success");
    } catch { toast("Failed to create note", "error"); }
  };

  const createTask = async () => {
    if (!newTaskTitle.trim()) return;
    try {
      await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTaskTitle }) });
      setNewTaskTitle("");
      loadTasks();
      toast("Task created", "success");
    } catch { toast("Failed to create task", "error"); }
  };

  const toggleTask = async (id: string, done: number) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: done ? 0 : 1 }) });
      loadTasks();
    } catch { toast("Failed to update task", "error"); }
  };

  const deleteNote = async (id: string) => {
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE" });
      loadNotes();
    } catch { toast("Failed to delete note", "error"); }
  };

  const deleteTask = async (id: string) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      loadTasks();
    } catch { toast("Failed to delete task", "error"); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === "notes" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("notes")}>Notes</button>
        <button className={`btn ${tab === "tasks" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("tasks")}>Tasks</button>
      </div>

      {tab === "notes" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">New Note</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Note title..." value={newNoteTitle} onChange={e => setNewNoteTitle(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && createNote()} />
              <button className="btn btn-primary" onClick={createNote}>Create</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {notes.map(note => (
              <div key={note.id} className="card" style={{ borderLeft: `3px solid ${note.color || "var(--hairline-strong)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{note.title || "Untitled"}</div>
                  <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: 11, border: "none" }} onClick={() => deleteNote(note.id)}>×</button>
                </div>
                {note.content && <div style={{ marginTop: 6, fontSize: 12, color: "var(--mute)", lineHeight: 1.4, maxHeight: 80, overflow: "hidden" }}>{note.content}</div>}
                {note.tags?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                    {note.tags.map(t => <span key={t} className="badge badge-gray">{t}</span>)}
                  </div>
                )}
              </div>
            ))}
            {notes.length === 0 && <div className="empty-state"><div className="empty-state-desc">No notes yet</div></div>}
          </div>
        </>
      )}

      {tab === "tasks" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">New Task</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Task title..." value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && createTask()} />
              <button className="btn btn-primary" onClick={createTask}>Add</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tasks.map(task => (
              <div key={task.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" }}>
                <input type="checkbox" checked={!!task.done} onChange={() => toggleTask(task.id, task.done)} style={{ cursor: "pointer" }} />
                <span style={{ flex: 1, textDecoration: task.done ? "line-through" : "none", color: task.done ? "var(--mute)" : "var(--ink)" }}>{task.title}</span>
                <span className={`badge ${task.priority === "high" ? "badge-red" : task.priority === "low" ? "badge-gray" : "badge-yellow"}`}>{task.priority}</span>
                <button className="btn-ghost" style={{ padding: "2px 6px", fontSize: 11, border: "none" }} onClick={() => deleteTask(task.id)}>×</button>
              </div>
            ))}
            {tasks.length === 0 && <div className="empty-state"><div className="empty-state-desc">No tasks yet</div></div>}
          </div>
        </>
      )}
    </div>
  );
}
