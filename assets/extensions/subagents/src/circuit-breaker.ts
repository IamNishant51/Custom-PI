import { AppError } from "./errors";

export class CircuitBreakerOpenError extends AppError {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker '${breakerName}' is open`, "CIRCUIT_BREAKER_OPEN");
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  state: "closed" | "open" | "half-open" = "closed";
  failureCount = 0;
  lastFailureTime = 0;
  readonly threshold: number;
  readonly resetTimeout: number;
  readonly halfOpenMaxRequests: number;
  private halfOpenRequests = 0;
  private readonly name: string;

  constructor(name: string, options?: { threshold?: number; resetTimeout?: number; halfOpenMaxRequests?: number }) {
    this.name = name;
    this.threshold = options?.threshold ?? 5;
    this.resetTimeout = options?.resetTimeout ?? 30_000;
    this.halfOpenMaxRequests = options?.halfOpenMaxRequests ?? 1;
  }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = "half-open";
        this.halfOpenRequests = 0;
      } else {
        if (fallback) return fallback();
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    if (this.state === "half-open" && this.halfOpenRequests >= this.halfOpenMaxRequests) {
      if (fallback) return fallback();
      throw new CircuitBreakerOpenError(this.name);
    }

    this.halfOpenRequests++;
    try {
      const result = await fn();
      if (this.state === "half-open") {
        this.state = "closed";
        this.failureCount = 0;
      }
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.threshold) {
        this.state = "open";
      }
      throw err;
    }
  }

  isOpen(): boolean {
    if (this.state === "open" && Date.now() - this.lastFailureTime > this.resetTimeout) {
      this.state = "half-open";
      this.halfOpenRequests = 0;
    }
    return this.state === "open";
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenRequests = 0;
  }
}

const _breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: { threshold?: number; resetTimeout?: number }): CircuitBreaker {
  if (!_breakers.has(name)) {
    _breakers.set(name, new CircuitBreaker(name, options));
  }
  return _breakers.get(name)!;
}
