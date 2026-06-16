interface SkeletonProps {
  lines?: number;
  width?: string;
  height?: string;
  variant?: "text" | "card" | "table" | "circle";
}

function SkeletonPulse({ width, height }: { width?: string; height?: string }) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width: width || "100%",
        height: height || "14px",
        borderRadius: "var(--radius-sm)",
      }}
    />
  );
}

export function LoadingSkeleton({ lines = 3, width, variant = "text" }: SkeletonProps) {
  if (variant === "card") {
    return (
      <div className="card" style={{ animation: "fadeIn 0.2s ease" }}>
        <SkeletonPulse width="60%" height="16px" />
        <div style={{ height: 8 }} />
        <SkeletonPulse />
        <div style={{ height: 4 }} />
        <SkeletonPulse width="80%" />
        <div style={{ height: 4 }} />
        <SkeletonPulse width="40%" />
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div style={{ display: "flex", gap: 16, padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
          <SkeletonPulse width="120px" />
          <SkeletonPulse width="80px" />
          <SkeletonPulse width="60px" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 16, padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
            <SkeletonPulse width="100px" />
            <SkeletonPulse width="60px" />
            <SkeletonPulse width="40px" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "circle") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, animation: "fadeIn 0.2s ease" }}>
        <div className="skeleton-pulse" style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <SkeletonPulse width="50%" />
          <div style={{ height: 6 }} />
          <SkeletonPulse width="80%" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <SkeletonPulse width={i === 0 && width ? width : undefined} />
        </div>
      ))}
    </div>
  );
}

export function PanelLoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div style={{ padding: 48, textAlign: "center" }}>
      <div className="loading-spinner" style={{ margin: "0 auto 12px" }} />
      <div style={{ fontSize: 13, color: "var(--mute)", fontFamily: "var(--font-mono)" }}>{message}</div>
    </div>
  );
}

export function PanelErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card-error" style={{ animation: "fadeIn 0.2s ease" }}>
      <div className="card-body">
        <div style={{ color: "var(--danger)", marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
          ✕ {message}
        </div>
        {onRetry && (
          <button className="btn btn-ghost" onClick={onRetry} style={{ fontSize: 12 }}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
