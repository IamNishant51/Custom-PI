import { useState } from "react";

export default function LoginPanel() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!r.ok) { const d = await r.json(); setError(d.error || "Login failed"); return; }
      window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 16, maxWidth: 400, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 16, textAlign: "center" }}>Login</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          autoFocus
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 13, textAlign: "center" }}>{error}</div>}
        <button className="btn btn-primary" onClick={handleLogin} disabled={loading} style={{ width: "100%" }}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </div>
    </div>
  );
}
