export type MemoryType = "fact" | "decision" | "preference" | "pattern" | "skill";

export interface SkillMeta {
  problemType: string;
  approach: string;
  keySteps: string[];
  complexityScore: number;
  successCount: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  project: string;
  embedding: number[];
  tags: string[];
  created: string;
  lastAccessed: string;
  accessCount: number;
  retrievalCount: number;
  retrievalSuccessCount: number;
  ttl: string;
  deprecated: boolean;
  correctedById?: string;
  skillMeta?: SkillMeta;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  byProject: Record<string, number>;
  oldestEntry: string;
  newestEntry: string;
  averageImportance: number;
  totalEpisodes: number;
  deprecatedCount: number;
  avgRetrievalSuccess: number;
}
