import { bus, Topics } from "../event-bus/event-bus";

export type ExpertiseLevel = "beginner" | "intermediate" | "advanced" | "expert";
export type CommunicationStyle = "concise" | "detailed" | "technical" | "educational" | "conversational";
export type EmotionalState = "frustrated" | "satisfied" | "neutral" | "urgent" | "curious" | "confused";

interface UserTrait {
  trait: string;
  confidence: number;
  firstObserved: number;
  lastObserved: number;
  observationCount: number;
  evidence: string[];
}

interface UserPreference {
  key: string;
  value: any;
  confidence: number;
  source: "explicit" | "inferred";
  createdAt: number;
  updatedAt: number;
}

interface InteractionHistory {
  totalInteractions: number;
  averageSessionLength: number;
  commonTaskTypes: string[];
  preferredTools: string[];
  averageCorrectionsPerSession: number;
  patiencesScore: number;
}

export interface UserModel {
  userId: string;
  expertise: ExpertiseLevel;
  communicationStyle: CommunicationStyle;
  emotionalState: EmotionalState;
  traits: Map<string, UserTrait>;
  preferences: Map<string, UserPreference>;
  interactionHistory: InteractionHistory;
  knowledgeDomains: Set<string>;
  trustLevel: number;
  updatedAt: number;
}

export class TheoryOfMind {
  private users = new Map<string, UserModel>();
  private observations: Array<{
    userId: string;
    observation: string;
    category: string;
    timestamp: number;
  }> = [];

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    bus.on(Topics.USER_ACTION, (event) => {
      this.observe(event.data.userId || "default", event.data.action, "action");
    });
    bus.on(Topics.USER_FEEDBACK, (event) => {
      this.processFeedback(event.data.userId || "default", event.data);
    });
    bus.on(Topics.MESSAGE_RECEIVED, (event) => {
      const msg = event.data;
      if (msg.role === "user") {
        this.analyzeUserMessage(msg.userId || "default", msg.content || "");
      }
    });
  }

  getUserModel(userId: string): UserModel {
    if (!this.users.has(userId)) {
      this.users.set(userId, this.createDefaultModel(userId));
    }
    return this.users.get(userId)!;
  }

  inferCommunicationStyle(userId: string): CommunicationStyle {
    const user = this.getUserModel(userId);
    return user.communicationStyle;
  }

  inferExpertise(userId: string): ExpertiseLevel {
    const user = this.getUserModel(userId);
    return user.expertise;
  }

  inferEmotionalState(userId: string): EmotionalState {
    const user = this.getUserModel(userId);
    return user.emotionalState;
  }

  getContextualAdvice(userId: string): string {
    const user = this.getUserModel(userId);
    const advice: string[] = [];

    if (user.emotionalState === "frustrated") {
      advice.push("User appears frustrated. Be extra clear, offer simpler solutions first.");
    }
    if (user.emotionalState === "urgent") {
      advice.push("User seems urgent. Prioritize speed over perfection.");
    }
    if (user.emotionalState === "confused") {
      advice.push("User seems confused. Provide more context and simpler explanations.");
    }

    if (user.expertise === "beginner") {
      advice.push("User may be new to this. Explain technical terms and provide step-by-step guidance.");
    } else if (user.expertise === "expert") {
      advice.push("User is experienced. Be technical and direct. Skip basic explanations.");
    }

    if (user.communicationStyle === "concise") {
      advice.push("User prefers concise responses. Get to the point quickly.");
    } else if (user.communicationStyle === "detailed") {
      advice.push("User prefers detailed explanations. Include rationale and alternatives.");
    }

    const correctionRate = user.interactionHistory.averageCorrectionsPerSession;
    if (correctionRate > 2) {
      advice.push("User has been correcting frequently. Double-check work before presenting.");
    }

    return advice.join("\n");
  }

  updatePreference(userId: string, key: string, value: any, source: "explicit" | "inferred" = "inferred"): void {
    const user = this.getUserModel(userId);
    const existing = user.preferences.get(key);
    if (existing) {
      existing.value = value;
      existing.confidence = Math.min(1, existing.confidence + (source === "explicit" ? 0.2 : 0.05));
      existing.updatedAt = Date.now();
    } else {
      user.preferences.set(key, {
        key,
        value,
        confidence: source === "explicit" ? 0.6 : 0.2,
        source,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    user.updatedAt = Date.now();
    bus.emit(Topics.USER_PREFERENCE, { userId, key, value, source }, { source: "theory-of-mind" });
  }

  getPreference(userId: string, key: string): any {
    const user = this.getUserModel(userId);
    return user.preferences.get(key)?.value;
  }

  setEmotionalState(userId: string, state: EmotionalState): void {
    const user = this.getUserModel(userId);
    user.emotionalState = state;
    user.updatedAt = Date.now();
  }

  addKnowledgeDomain(userId: string, domain: string): void {
    this.getUserModel(userId).knowledgeDomains.add(domain);
  }

  getTrustLevel(userId: string): number {
    return this.getUserModel(userId).trustLevel;
  }

  adjustTrust(userId: string, delta: number): void {
    const user = this.getUserModel(userId);
    user.trustLevel = Math.max(0, Math.min(1, user.trustLevel + delta));
    user.updatedAt = Date.now();
  }

  getInteractionHistory(userId: string): InteractionHistory {
    return this.getUserModel(userId).interactionHistory;
  }

  private observe(userId: string, action: string, category: string): void {
    this.observations.push({ userId, observation: action, category, timestamp: Date.now() });
    if (this.observations.length > 10000) this.observations.splice(0, 1000);
    this.updateTraits(userId, action);
  }

  public analyzeUserMessage(userId: string, content: string): void {
    const user = this.getUserModel(userId);

    if (content.length > 500) {
      user.communicationStyle = "detailed";
    } else if (content.length < 50) {
      user.communicationStyle = "concise";
    }

    const techTerms = ["function", "class", "API", "database", "deploy", "config", "type", "interface", "async", "Promise", "Docker", "Kubernetes", "CI/CD", "pipeline", "algorithm", "O(n"];
    const techCount = techTerms.filter(t => content.includes(t)).length;
    if (techCount >= 3) {
      user.expertise = "advanced";
    } else if (techCount >= 1) {
      if (user.expertise === "beginner") user.expertise = "intermediate";
    }

    const frustrationSignals = ["why", "not working", "error", "bug", "broken", "fix this", "annoying", "useless"];
    if (frustrationSignals.some(s => content.toLowerCase().includes(s))) {
      user.emotionalState = "frustrated";
    }

    const urgencySignals = ["asap", "urgent", "immediately", "now", " hurry", "deadline", "critical", "emergency"];
    if (urgencySignals.some(s => content.toLowerCase().includes(s))) {
      user.emotionalState = "urgent";
    }

    const confusionSignals = ["what?", "confused", "don't understand", "how does", "explain", "?", "??"];
    if (confusionSignals.some(s => content.toLowerCase().includes(s))) {
      if (user.emotionalState !== "urgent" && user.emotionalState !== "frustrated") {
        user.emotionalState = "confused";
      }
    }

    if (content.includes("thank") || content.includes("great") || content.includes("perfect") || content.includes("nice")) {
      user.emotionalState = "satisfied";
      this.adjustTrust(userId, 0.02);
    }

    user.interactionHistory.totalInteractions++;
    user.updatedAt = Date.now();
  }

  private processFeedback(userId: string, feedback: any): void {
    if (feedback.positive) {
      this.adjustTrust(userId, 0.05);
      this.setEmotionalState(userId, "satisfied");
    }
    if (feedback.correction) {
      const user = this.getUserModel(userId);
      user.interactionHistory.averageCorrectionsPerSession += 0.1;
      this.adjustTrust(userId, -0.02);
    }
    if (feedback.preference) {
      for (const [key, value] of Object.entries(feedback.preference)) {
        this.updatePreference(userId, key, value, "explicit");
      }
    }
  }

  private updateTraits(userId: string, action: string): void {
    const user = this.getUserModel(userId);
    const traitPatterns: Array<{ name: string; match: string; category: string }> = [
      { name: "risk_tolerance", match: "deploy|release|production", category: "behavior" },
      { name: "perfectionism", match: "refactor|clean|optimize|rewrite", category: "behavior" },
      { name: "speed_preference", match: "quick|fast|hack|temporary|just make it work", category: "behavior" },
      { name: "documentation_focus", match: "comment|doc|readme|explain", category: "behavior" },
      { name: "testing_focus", match: "test|coverage|spec|assert", category: "behavior" },
    ];

    for (const pattern of traitPatterns) {
      if (new RegExp(pattern.match, "i").test(action)) {
        const existing = user.traits.get(pattern.name);
        if (existing) {
          existing.confidence = Math.min(1, existing.confidence + 0.05);
          existing.lastObserved = Date.now();
          existing.observationCount++;
          if (!existing.evidence.includes(action.slice(0, 100))) {
            existing.evidence.push(action.slice(0, 100));
          }
        } else {
          user.traits.set(pattern.name, {
            trait: pattern.name,
            confidence: 0.2,
            firstObserved: Date.now(),
            lastObserved: Date.now(),
            observationCount: 1,
            evidence: [action.slice(0, 100)],
          });
        }
      }
    }
  }

  private createDefaultModel(userId: string): UserModel {
    return {
      userId,
      expertise: "intermediate",
      communicationStyle: "conversational",
      emotionalState: "neutral",
      traits: new Map(),
      preferences: new Map(),
      interactionHistory: {
        totalInteractions: 0,
        averageSessionLength: 0,
        commonTaskTypes: [],
        preferredTools: [],
        averageCorrectionsPerSession: 0,
        patiencesScore: 0.5,
      },
      knowledgeDomains: new Set(),
      trustLevel: 0.5,
      updatedAt: Date.now(),
    };
  }

  async persist(userId: string): Promise<void> {
    const user = this.getUserModel(userId);
    try {
      const getGraph = (await import("../state-graph/property-graph")).getGraph;
      const graph = getGraph();
      graph.addNode("user_preference", `User ${userId}`, {
        userId,
        expertise: user.expertise,
        communicationStyle: user.communicationStyle,
        trustLevel: user.trustLevel,
        preferences: Object.fromEntries(user.preferences),
      }, { id: `user_model_${userId}` });
    } catch {}
  }
}

export const theoryOfMind = new TheoryOfMind();
