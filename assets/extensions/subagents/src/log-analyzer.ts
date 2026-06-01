import { insertFailureTriplet, queryFailureTriplets, insertIncident, queryOpenIncidents } from "./state-db";
import { completeSimple } from "@earendil-works/pi-ai";
import crypto from "node:crypto";

export interface WebhookEvent {
  source: string;
  type: string;
  payload: any;
  receivedAt: number;
}

export interface FailureAnalysis {
  componentId: string;
  componentLabel: string;
  errorCode: string;
  errorMessage: string;
  severity: string;
  summary: string;
}

const FAILURE_PROMPT = `You are a log analyzer. Parse the following raw log/event and extract failure information.
Return ONLY valid JSON:
{
  "componentId": "kebab-case-identifier",
  "componentLabel": "Human readable component name",
  "errorCode": "ERR_CODE or HTTP 500",
  "errorMessage": "Brief description of the error",
  "severity": "low|medium|high|critical",
  "summary": "One-line summary for incident tracking"
}

EVENT:
{raw_text}`;

function genId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export async function analyzeLogEvent(
  rawText: string,
  source: string,
  model: any,
  auth: { apiKey?: string; headers?: Record<string, string> },
): Promise<FailureAnalysis | null> {
  const prompt = FAILURE_PROMPT.replace("{raw_text}", rawText.slice(0, 3000));
  try {
    const response = await completeSimple(model, {
      systemPrompt: "You extract structured failure data from logs. Output only valid JSON.",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    }, { apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" as any });

    const text = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    const match = text.match(/\{[^{}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.componentId || !parsed.errorCode) return null;
    return parsed as FailureAnalysis;
  } catch {
    return null;
  }
}

export function processFailureEvent(
  event: WebhookEvent,
  analysis: FailureAnalysis,
): void {
  const now = Date.now();
  const ftId = genId();
  insertFailureTriplet({
    id: ftId,
    componentId: analysis.componentId,
    componentLabel: analysis.componentLabel,
    errorCode: analysis.errorCode,
    errorMessage: analysis.errorMessage,
    severity: analysis.severity,
    source: event.source,
    rawLog: JSON.stringify(event.payload).slice(0, 2000),
    createdAt: now,
    acknowledged: 0,
  });

  const incId = `inc_${analysis.componentId}_${analysis.errorCode}`;
  insertIncident({
    id: incId,
    summary: analysis.summary || `${analysis.componentLabel}: ${analysis.errorCode}`,
    component: analysis.componentId,
    errorCode: analysis.errorCode,
    severity: analysis.severity,
  });
}

export function checkProactiveTriage(): { needsTriage: boolean; incidents: any[] } {
  const openIncidents = queryOpenIncidents();
  const recent = openIncidents.filter((i: any) => i.count >= 3);
  return { needsTriage: recent.length > 0, incidents: recent };
}
