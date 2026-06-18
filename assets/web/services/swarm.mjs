let currentSwarmState = null;
let _swarmPaused = false;
let _swarmPauseResolve = null;
let _toolCallCount = 0;
let _approvalEnabled = false;

let swarmLock = Promise.resolve();
async function withSwarmLock(fn) {
  const prev = swarmLock;
  let release;
  swarmLock = new Promise(resolve => { release = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function setSwarmState(state) {
  await withSwarmLock(() => { currentSwarmState = state; });
}
export async function setSwarmPaused(v) {
  await withSwarmLock(() => { _swarmPaused = v; });
}
export async function setSwarmPauseResolve(v) {
  await withSwarmLock(() => { _swarmPauseResolve = v; });
}
export async function getSwarmState() {
  return await withSwarmLock(() => currentSwarmState);
}
export async function getSwarmPaused() {
  return await withSwarmLock(() => _swarmPaused);
}
export async function getSwarmPauseResolve() {
  return await withSwarmLock(() => _swarmPauseResolve);
}
export async function incrementToolCallCount() {
  await withSwarmLock(() => { _toolCallCount++; });
}
export async function getToolCallCount() {
  return await withSwarmLock(() => _toolCallCount);
}
export async function setApprovalEnabled(v) {
  await withSwarmLock(() => { _approvalEnabled = v; });
}
export async function getApprovalEnabled() {
  return await withSwarmLock(() => _approvalEnabled);
}

// Swarm broadcast — send to all connected WS clients
const swarmSockets = new Set();

export function addSwarmSocket(sock) {
  swarmSockets.add(sock);
}

export function removeSwarmSocket(sock) {
  swarmSockets.delete(sock);
}

export function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const sock of swarmSockets) {
    try { sock.send(msg); } catch { swarmSockets.delete(sock); }
  }
}

export function getSwarmSockets() {
  return swarmSockets;
}

export function redactToolInput(input) {
  const s = JSON.stringify(input);
  if (s.length <= 300) return s;
  const redacted = Object.fromEntries(
    Object.entries(input).map(([k, v]) => {
      if (typeof v === "string" && v.length > 100) return [k, `[REDACTED (${v.length} chars)]`];
      return [k, v];
    })
  );
  let out = JSON.stringify(redacted);
  return out.length > 300 ? out.slice(0, 300) + "...[truncated]" : out;
}

export function bcast(data) {
  broadcast(data);
  if (!currentSwarmState) return;
  withSwarmLock(async () => {
    if (data.type === "ceo_thought" && data.message) {
      currentSwarmState.ceoLogs.push(data.message);
    } else if (data.type === "agent_status" && data.agentId) {
      const a = currentSwarmState.agents.find(x => x.id === data.agentId);
      if (a) {
        if (data.status) a.status = data.status;
        if (data.currentTool !== undefined) a.currentTool = data.currentTool;
        if (data.currentTask !== undefined) a.currentTask = data.currentTask;
      }
    } else if (data.type === "agent_log" && data.agentId && data.message) {
      const a = currentSwarmState.agents.find(x => x.id === data.agentId);
      if (a) {
        a.logs.push(data.message);
        if (a.logs.length > 1000) a.logs.splice(0, a.logs.length - 1000);
      }
    } else if (data.type === "tool_request" && data.agentId) {
      currentSwarmState.ceoLogs.push(`\u26a0 Agent '${data.agentId}' requested tool: ${data.toolName}`);
    } else if (data.type === "tool_provisioned" && data.agentId) {
      currentSwarmState.ceoLogs.push(`\u2713 Custom tool '${data.toolName}' provisioned to '${data.agentId}'.`);
    } else if (data.type === "swarm_start") {
      currentSwarmState.ceoLogs.push(`Swarm initialized for: "${data.goal}"`);
    }
  }).catch(() => {});
}
