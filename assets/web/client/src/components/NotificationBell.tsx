import { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: number;
  created_at: number;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try { const r = await fetch("/api/notifications/unread-count"); if (r.ok) setUnreadCount((await r.json()).count || 0); } catch {}
  }, []);

  const fetchNotifications = useCallback(async () => {
    try { const r = await fetch("/api/notifications?limit=20"); if (r.ok) setNotifications((await r.json()).notifications || []); } catch {}
  }, []);

  useEffect(() => { fetchUnreadCount(); const t = setInterval(fetchUnreadCount, 15000); return () => clearInterval(t); }, [fetchUnreadCount]);

  useEffect(() => { if (open) fetchNotifications(); }, [open, fetchNotifications]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id: string) => {
    try { await fetch(`/api/notifications/${id}/read`, { method: "POST" }); } catch {}
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    try { await fetch("/api/notifications/read-all", { method: "POST" }); } catch {}
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    setUnreadCount(0);
  };

  return (
    <div className="notification-bell-wrapper" ref={dropdownRef}>
      <button
        className="notification-bell"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <span className="notification-bell-icon">🔔</span>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="btn btn-small btn-ghost" onClick={markAllRead} style={{ fontSize: 11 }}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notification-dropdown-list">
            {notifications.length === 0 && (
              <div className="notification-empty">No notifications</div>
            )}
            {notifications.map(n => (
              <div
                key={n.id}
                className={`notification-item ${!n.read ? "unread" : ""}`}
                onClick={() => { if (!n.read) markRead(n.id); }}
              >
                <div className="notification-item-title">{n.title}</div>
                {n.body && <div className="notification-item-body">{n.body}</div>}
                <div className="notification-item-time">
                  {new Date(n.created_at).toLocaleString()}
                  {!n.read && <span className="notification-unread-dot" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
