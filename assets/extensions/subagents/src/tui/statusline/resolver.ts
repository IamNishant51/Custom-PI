import { resolveVariable, StatusLineContext } from "./variables";

function applyFormat(value: string, spec?: string): string {
  if (!spec) return value;

  switch (spec) {
    case "k": {
      const n = Number(value);
      if (isNaN(n)) return value;
      if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
      return value;
    }
    case "usd": {
      const n = Number(value);
      return isNaN(n) ? value : `$${n.toFixed(2)}`;
    }
    case "pct":
      return `${value}%`;
    case "basename": {
      const parts = value.split("/");
      return parts[parts.length - 1] || value;
    }
    case "dir": {
      const idx = value.lastIndexOf("/");
      return idx >= 0 ? value.slice(0, idx) || "/" : ".";
    }
    case "time": {
      const ms = Number(value);
      if (isNaN(ms)) return value;
      const sec = Math.floor(ms / 1000);
      const min = Math.floor(sec / 60);
      const hr = Math.floor(min / 60);
      if (hr > 0) return `${hr}h ${min % 60}m`;
      if (min > 0) return `${min}m ${sec % 60}s`;
      return `${sec}s`;
    }
    default:
      return value;
  }
}

export function resolveTemplate(template: string, ctx: StatusLineContext): string {
  return template.replace(/\{(\w+)(?::(\w+))?\}/g, (_match, name: string, spec?: string) => {
    const value = resolveVariable(name, ctx);
    if (value == null) return `<${name}:unavailable>`;
    return applyFormat(value, spec);
  });
}
