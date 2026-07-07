export class AppError extends Error {
  public readonly code: string;

  constructor(message: string, code?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code || "INTERNAL_ERROR";
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message, code: this.code };
  }
}

export class ToolExecutionError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "TOOL_EXECUTION_ERROR", options);
    this.name = "ToolExecutionError";
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    const msg = id ? `${entity} '${id}' not found` : `${entity} not found`;
    super(msg, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class SecurityError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "SECURITY_ERROR", options);
    this.name = "SecurityError";
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR");
    this.name = "ConfigurationError";
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "DATABASE_ERROR", options);
    this.name = "DatabaseError";
  }
}

export class NetworkError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "NETWORK_ERROR", options);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "TIMEOUT_ERROR", options);
    this.name = "TimeoutError";
  }
}
