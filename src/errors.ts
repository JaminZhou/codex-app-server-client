import type { JsonRpcErrorData, JsonValue } from "./types";
import type { Turn } from "./generated/protocol/v2/Turn";

export class CodexAppServerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexAppServerError";
  }
}

export class AppServerRpcError extends CodexAppServerError {
  readonly code: number;
  readonly data: JsonValue | undefined;
  readonly rpcMessage: string;

  constructor(error: JsonRpcErrorData) {
    super(`JSON-RPC error ${error.code}: ${error.message}`);
    this.name = "AppServerRpcError";
    this.code = error.code;
    this.data = error.data;
    this.rpcMessage = error.message;
  }
}

export class AppServerParseError extends AppServerRpcError {
  override name = "AppServerParseError";
}

export class AppServerInvalidRequestError extends AppServerRpcError {
  override name = "AppServerInvalidRequestError";
}

export class AppServerMethodNotFoundError extends AppServerRpcError {
  override name = "AppServerMethodNotFoundError";
}

export class AppServerInvalidParamsError extends AppServerRpcError {
  override name = "AppServerInvalidParamsError";
}

export class AppServerInternalRpcError extends AppServerRpcError {
  override name = "AppServerInternalRpcError";
}

export class AppServerServerError extends AppServerRpcError {
  override name = "AppServerServerError";
}

export class AppServerBusyError extends AppServerServerError {
  override name = "AppServerBusyError";
}

export class AppServerRetryLimitExceededError extends AppServerBusyError {
  override name = "AppServerRetryLimitExceededError";
}

export class AppServerConnectionClosedError extends CodexAppServerError {
  constructor(message = "The codex app-server connection is closed.", options?: ErrorOptions) {
    super(message, options);
    this.name = "AppServerConnectionClosedError";
  }
}

export class CodexBinaryResolutionError extends CodexAppServerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexBinaryResolutionError";
  }
}

export class AppServerProtocolError extends CodexAppServerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppServerProtocolError";
  }
}

export class AppServerRequestTimeoutError extends CodexAppServerError {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`Request ${method} timed out after ${timeoutMs}ms.`);
    this.name = "AppServerRequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class AppServerRequestAbortedError extends CodexAppServerError {
  readonly method: string;

  constructor(method: string, reason?: unknown) {
    super(`Request ${method} was aborted.`, reason instanceof Error ? { cause: reason } : undefined);
    this.name = "AppServerRequestAbortedError";
    this.method = method;
  }
}

export class CodexTurnFailedError extends CodexAppServerError {
  readonly turn: Turn;

  constructor(turn: Turn) {
    super(turn.error?.message || `Codex turn ${turn.id} failed.`);
    this.name = "CodexTurnFailedError";
    this.turn = turn;
  }
}

/** Throw from a server-request handler to control the JSON-RPC error response. */
export class AppServerServerRequestError extends CodexAppServerError {
  readonly code: number;
  readonly data: JsonValue | undefined;

  constructor(message: string, code = -32000, data?: JsonValue) {
    super(message);
    this.name = "AppServerServerRequestError";
    this.code = code;
    this.data = data;
  }
}

export function mapAppServerRpcError(error: JsonRpcErrorData): AppServerRpcError {
  switch (error.code) {
    case -32700:
      return new AppServerParseError(error);
    case -32600:
      return new AppServerInvalidRequestError(error);
    case -32601:
      return new AppServerMethodNotFoundError(error);
    case -32602:
      return new AppServerInvalidParamsError(error);
    case -32603:
      return new AppServerInternalRpcError(error);
  }

  if (error.code >= -32099 && error.code <= -32000) {
    if (containsRetryLimitText(error.message)) {
      return new AppServerRetryLimitExceededError(error);
    }
    if (containsServerOverloaded(error.data) || isIngressOverload(error)) {
      return new AppServerBusyError(error);
    }
    return new AppServerServerError(error);
  }

  return new AppServerRpcError(error);
}

export function isRetryableAppServerError(error: unknown): boolean {
  return (
    error instanceof AppServerBusyError ||
    (error instanceof AppServerRpcError && containsServerOverloaded(error.data))
  );
}

function containsRetryLimitText(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("retry limit") || normalized.includes("too many failed attempts");
}

function isIngressOverload(error: JsonRpcErrorData): boolean {
  if (error.code !== -32001) return false;
  const normalized = error.message.toLowerCase();
  return normalized.includes("server overloaded") || normalized.includes("retry later");
}

function containsServerOverloaded(value: JsonValue | undefined): boolean {
  if (typeof value === "string") return value.toLowerCase() === "server_overloaded";
  if (Array.isArray(value)) return value.some(containsServerOverloaded);
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsServerOverloaded(item));
  }
  return false;
}
