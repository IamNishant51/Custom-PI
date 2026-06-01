import { insertTriplet, queryTriplets, type TripletRecord } from "./state-db";
import { completeSimple } from "@earendil-works/pi-ai";
import crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionRequest {
  rawText: string;
  sourceSession: string;
  contextHint?: string;
}

export interface ExtractedTriplet {
  subjectId: string;
  subjectType: string;
  subjectLabel: string;
  predicateType: string;
  predicateLabel: string;
  objectId: string;
  objectType: string;
  objectLabel: string;
  confidenceScore: number;
}

export interface ExtractionResult {
  triplets: ExtractedTriplet[];
  raw: string;
  error?: string;
}

// ── LLM Prompt ─────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a knowledge extraction engine. Given the raw text below, extract up to 5 structured triplets (Subject → Predicate → Object) representing facts, relationships, and decisions.

For each triplet, provide:
- subject_id: A stable identifier (kebab-case, e.g., "file-src-index")
- subject_type: One of: "file", "function", "class", "concept", "tool", "dependency", "setting", "person"
- subject_label: Human-readable name
- predicate_type: One of: "depends_on", "implements", "configures", "defines", "calls", "generates", "modifies", "uses", "returns", "references"
- predicate_label: Human-readable relationship description
- object_id: Stable identifier
- object_type: Same types as subject
- object_label: Human-readable name
- confidenceScore: 0.0 to 1.0 — how certain you are this fact is correct

Output ONLY valid JSON array:
[
  {
    "subjectId": "...",
    "subjectType": "...",
    "subjectLabel": "...",
    "predicateType": "...",
    "predicateLabel": "...",
    "objectId": "...",
    "objectType": "...",
    "objectLabel": "...",
    "confidenceScore": 0.95
  }
]

If no triplets can be extracted, return [].

RAW TEXT:
{raw_text}`;

// ── Generator ──────────────────────────────────────────────────────────────

function genId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export async function extractTriplets(
  request: ExtractionRequest,
  model: any,
  auth: { apiKey?: string; headers?: Record<string, string> },
): Promise<ExtractionResult> {
  const prompt = EXTRACTION_PROMPT.replace("{raw_text}", request.rawText.slice(0, 4000));

  try {
    const response = await completeSimple(model, {
      systemPrompt: "You are a precise knowledge extraction engine. Output only valid JSON arrays.",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      reasoning: "low" as any,
    });

    const text = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try extracting array from text
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return { triplets: [], raw: text, error: "Failed to parse LLM output as JSON" };
      }
    }

    if (!Array.isArray(parsed)) {
      return { triplets: [], raw: text, error: "LLM output is not an array" };
    }

    const triplets: ExtractedTriplet[] = [];
    for (const item of parsed.slice(0, 5)) {
      if (!item.subjectId || !item.predicateType || !item.objectId) continue;
      triplets.push({
        subjectId: item.subjectId,
        subjectType: item.subjectType || "concept",
        subjectLabel: item.subjectLabel || item.subjectId,
        predicateType: item.predicateType,
        predicateLabel: item.predicateLabel || item.predicateType,
        objectId: item.objectId,
        objectType: item.objectType || "concept",
        objectLabel: item.objectLabel || item.objectId,
        confidenceScore: Math.min(1, Math.max(0, item.confidenceScore ?? 0.5)),
      });
    }

    return { triplets, raw: text };
  } catch (e: any) {
    return { triplets: [], raw: "", error: e.message || String(e) };
  }
}

export async function persistTriplets(
  triplets: ExtractedTriplet[],
  sourceSession: string,
): Promise<number> {
  let count = 0;
  for (const t of triplets) {
    // Skip low-confidence or existing duplicates
    if (t.confidenceScore < 0.4) continue;

    const existing = queryTriplets({
      subjectId: t.subjectId,
      predicateType: t.predicateType,
      objectId: t.objectId,
    });
    if (existing.length > 0) {
      // Update existing if new confidence is higher
      const best = existing.reduce((a, b) => a.confidenceScore > b.confidenceScore ? a : b);
      if (t.confidenceScore > best.confidenceScore) {
        insertTriplet({
          id: best.id,
          subjectId: t.subjectId,
          subjectType: t.subjectType,
          subjectLabel: t.subjectLabel,
          predicateType: t.predicateType,
          predicateLabel: t.predicateLabel,
          objectId: t.objectId,
          objectType: t.objectType,
          objectLabel: t.objectLabel,
          confidenceScore: t.confidenceScore,
          sourceSession,
        });
        count++;
      }
    } else {
      insertTriplet({
        id: genId(),
        subjectId: t.subjectId,
        subjectType: t.subjectType,
        subjectLabel: t.subjectLabel,
        predicateType: t.predicateType,
        predicateLabel: t.predicateLabel,
        objectId: t.objectId,
        objectType: t.objectType,
        objectLabel: t.objectLabel,
        confidenceScore: t.confidenceScore,
        sourceSession,
      });
      count++;
    }
  }
  return count;
}
