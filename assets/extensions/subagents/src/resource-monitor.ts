import fs from "node:fs";

export interface HostMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  loadAvg: number[];
}

export function getHostMetrics(): HostMetrics {
  try {
    const cpuPercent = getCpuUsage();
    const memInfo = getMemoryInfo();
    const loadAvg = fs.existsSync("/proc/loadavg")
      ? fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).slice(0, 3).map(Number)
      : [0, 0, 0];
    return { cpuPercent, ...memInfo, loadAvg };
  } catch {
    return { cpuPercent: 0, memoryPercent: 0, memoryUsedMb: 0, memoryTotalMb: 0, loadAvg: [0, 0, 0] };
  }
}

function getCpuUsage(): number {
  try {
    if (!fs.existsSync("/proc/stat")) return 0;
    const lines = fs.readFileSync("/proc/stat", "utf8").split("\n");
    const cpuLine = lines.find(l => l.startsWith("cpu "));
    if (!cpuLine) return 0;
    const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
    const total = parts.reduce((a, b) => a + b, 0);
    const idle = parts[3] || 0;
    return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
  } catch { return 0; }
}

function getMemoryInfo(): { memoryPercent: number; memoryUsedMb: number; memoryTotalMb: number } {
  try {
    if (!fs.existsSync("/proc/meminfo")) return { memoryPercent: 0, memoryUsedMb: 0, memoryTotalMb: 0 };
    const text = fs.readFileSync("/proc/meminfo", "utf8");
    const totalMatch = text.match(/MemTotal:\s+(\d+)/);
    const availMatch = text.match(/MemAvailable:\s+(\d+)/);
    if (!totalMatch) return { memoryPercent: 0, memoryUsedMb: 0, memoryTotalMb: 0 };
    const totalKb = parseInt(totalMatch[1], 10);
    const availKb = availMatch ? parseInt(availMatch[1], 10) : totalKb;
    const usedKb = totalKb - availKb;
    return {
      memoryTotalMb: Math.round(totalKb / 1024),
      memoryUsedMb: Math.round(usedKb / 1024),
      memoryPercent: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
    };
  } catch { return { memoryPercent: 0, memoryUsedMb: 0, memoryTotalMb: 0 }; }
}

export function calculateTaskPenalty(metrics: HostMetrics): number {
  // Returns multiplier: 1.0 = normal, >1.0 = expensive (avoid parallel work)
  let penalty = 1.0;
  if (metrics.cpuPercent > 80) penalty += 0.5;
  if (metrics.cpuPercent > 90) penalty += 1.0;
  if (metrics.memoryPercent > 80) penalty += 0.3;
  if (metrics.memoryPercent > 90) penalty += 0.7;
  if (metrics.loadAvg[0] > metrics.cpuPercent / 100 * 4) penalty += 0.5;
  return Math.min(penalty, 4.0);
}

export function getResourceAdvisory(metrics: HostMetrics): string {
  const warnings: string[] = [];
  if (metrics.cpuPercent > 80) warnings.push(`CPU at ${metrics.cpuPercent}%`);
  if (metrics.memoryPercent > 80) warnings.push(`Memory at ${metrics.memoryPercent}%`);
  if (warnings.length === 0) return "Resources normal.";
  return `⚠ Resource warning: ${warnings.join(", ")}. Task penalty: ${calculateTaskPenalty(metrics).toFixed(1)}x`;
}
