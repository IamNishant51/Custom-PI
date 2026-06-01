import { upsertServiceHealth, getServiceHealth } from "./state-db";

interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

export interface ServiceEndpoint {
  name: string;
  url: string;
  method?: string;
  testBody?: string;
  expectedStatus?: number;
  timeoutMs?: number;
}

export async function checkEndpoint(service: ServiceEndpoint): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), service.timeoutMs || 10000);
    const res = await fetch(service.url, {
      method: service.method || "GET",
      body: service.testBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const ok = service.expectedStatus ? res.status === service.expectedStatus : res.status < 500;
    return { ok, latencyMs, statusCode: res.status };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  }
}

export function classifyLatency(latencyMs: number): string {
  if (latencyMs < 50) return "excellent";
  if (latencyMs < 150) return "good";
  if (latencyMs < 500) return "degraded";
  if (latencyMs < 2000) return "slow";
  return "critical";
}

export async function monitorService(endpoint: ServiceEndpoint): Promise<void> {
  const result = await checkEndpoint(endpoint);
  const now = Date.now();
  const prev = getServiceHealth(endpoint.name);
  const prevJitter = prev?.jitterMs || 0;
  const prevLatency = prev?.latencyMs || result.latencyMs;
  const jitterMs = Math.abs(result.latencyMs - prevLatency);

  upsertServiceHealth({
    serviceName: endpoint.name,
    endpoint: endpoint.url,
    status: result.ok ? "healthy" : "unhealthy",
    latencyMs: result.latencyMs,
    jitterMs: (prevJitter * 0.7 + jitterMs * 0.3),
    lastOk: result.ok ? now : (prev?.lastOk || now),
    lastFail: result.ok ? (prev?.lastFail || 0) : now,
    consecutiveFailures: result.ok ? 0 : (prev?.consecutiveFailures || 0) + 1,
    updatedAt: now,
  });
}

export function buildStatusSummary(services: ServiceEndpoint[]): string {
  const lines: string[] = [];
  for (const svc of services) {
    const health = getServiceHealth(svc.name);
    if (!health) {
      lines.push(`  - ${svc.name}: unknown (not yet checked)`);
      continue;
    }
    const latencyLabel = classifyLatency(health.latencyMs);
    const statusIcon = health.status === "healthy" ? "✓" : health.consecutiveFailures > 3 ? "✗" : "⚠";
    lines.push(`  ${statusIcon} ${svc.name}: ${health.status} (${health.latencyMs.toFixed(0)}ms, ${latencyLabel})`);
  }
  return lines.join("\n");
}
