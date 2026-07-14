import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  AppServerConnectionClosedError,
  AppServerProtocolError,
  AppServerRequestAbortedError,
  AppServerRequestTimeoutError,
  AppServerServerRequestError,
  mapAppServerRpcError,
} from "./errors";
import type {
  JsonRpcErrorData,
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonValue,
  JsonlRpcPeerOptions,
  NotificationHandler,
  RequestId,
  RequestOptions,
  ServerRequestHandler,
} from "./types";

interface PendingRequest {
  cleanup: () => void;
  reject: (error: Error) => void;
  resolve: (value: JsonValue) => void;
}

export class JsonlRpcPeer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly options: JsonlRpcPeerOptions;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly reader: ReadLineInterface;
  private writeQueue: Promise<void> = Promise.resolve();
  private notificationQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private serverRequestHandler: ServerRequestHandler | null = null;

  constructor(input: Readable, output: Writable, options: JsonlRpcPeerOptions = {}) {
    this.input = input;
    this.output = output;
    this.options = options;
    this.reader = createInterface({ input, crlfDelay: Infinity });
    this.reader.on("line", (line) => this.handleLine(line));
    this.reader.once("close", () => {
      if (!this.closed) {
        this.dispose(new AppServerConnectionClosedError("codex app-server closed stdout."));
      }
    });
    this.input.once("error", (error) => this.dispose(asError(error)));
    this.output.once("error", (error) => this.dispose(asError(error)));
  }

  request<T = JsonValue>(
    method: string,
    params?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    this.assertOpen();
    validateRequestOptions(options);

    const id = this.nextRequestId();
    const signal = options.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    const promise = new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      };
      const fail = (error: Error) => {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        request.cleanup();
        request.reject(error);
      };

      this.pending.set(id, {
        cleanup,
        reject,
        resolve: (value) => resolve(value as T),
      });

      if (options.timeoutMs !== undefined) {
        timer = setTimeout(
          () => fail(new AppServerRequestTimeoutError(method, options.timeoutMs!)),
          options.timeoutMs,
        );
      }
      if (signal) {
        abortHandler = () => fail(new AppServerRequestAbortedError(method, signal.reason));
        signal.addEventListener("abort", abortHandler, { once: true });
        if (signal.aborted) abortHandler();
      }

      if (!this.pending.has(id)) return;
      void this.enqueueWrite(
        { id, method, ...(params === undefined ? {} : { params }) },
        () => this.pending.has(id),
      ).catch((error) => fail(asError(error)));
    });

    return promise;
  }

  notify(method: string, params?: unknown): Promise<void> {
    this.assertOpen();
    return this.enqueueWrite({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.assertOpen();
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.assertOpen();
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) this.serverRequestHandler = null;
    };
  }

  dispose(reason: Error = new AppServerConnectionClosedError()): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.close();
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(reason);
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    this.serverRequestHandler = null;
  }

  private nextRequestId(): RequestId {
    const id = this.options.requestIdFactory?.() ?? randomUUID();
    if (!isRequestId(id)) {
      throw new TypeError("requestIdFactory must return a string, number, or bigint.");
    }
    if (this.pending.has(id)) throw new Error(`Duplicate JSON-RPC request id: ${String(id)}`);
    return id;
  }

  private assertOpen(): void {
    if (this.closed) throw new AppServerConnectionClosedError();
  }

  private enqueueWrite(message: JsonRpcMessage, shouldWrite: () => boolean = () => true): Promise<void> {
    this.assertOpen();
    let serialized: string;
    try {
      serialized = `${stringifyJsonPreservingBigInts(message)}\n`;
    } catch (error) {
      return Promise.reject(
        new AppServerProtocolError("JSON-RPC message is not safely serializable.", {
          cause: error,
        }),
      );
    }
    const operation = this.writeQueue.then(() => {
      this.assertOpen();
      if (!shouldWrite()) return;
      return new Promise<void>((resolve, reject) => {
        try {
          this.output.write(serialized, "utf8", (error?: Error | null) => {
            if (error) reject(error);
            else resolve();
          });
        } catch (error) {
          reject(asError(error));
        }
      });
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private handleLine(line: string): void {
    if (!line.trim() || this.closed) return;

    let value: unknown;
    try {
      value = parseJsonPreservingLargeIntegers(line);
    } catch (error) {
      this.dispose(new AppServerProtocolError("Received invalid JSONL from codex app-server.", { cause: error }));
      return;
    }

    try {
      const message = classifyMessage(value);
      if ("method" in message) {
        if ("id" in message) {
          void this.handleServerRequest(message).catch((error) => this.dispose(asError(error)));
        } else {
          this.notificationQueue = this.notificationQueue
            .then(() => this.handleNotification(message))
            .catch((error) => this.reportUnhandledError(asError(error)));
        }
      } else {
        this.handleResponse(message);
      }
    } catch (error) {
      this.dispose(asError(error));
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    request.cleanup();

    if ("error" in response) request.reject(mapAppServerRpcError(response.error));
    else request.resolve(response.result);
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    for (const handler of [...this.notificationHandlers]) await handler(notification);
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.serverRequestHandler) {
      await this.enqueueWrite({
        id: request.id,
        error: {
          code: -32601,
          message: `Unsupported server request: ${request.method}`,
        },
      } satisfies JsonRpcErrorResponse);
      return;
    }

    try {
      const result = await this.serverRequestHandler(request);
      await this.enqueueWrite({ id: request.id, result });
    } catch (error) {
      const requestError =
        error instanceof AppServerServerRequestError
          ? error
          : new AppServerServerRequestError(error instanceof Error ? error.message : String(error));
      await this.enqueueWrite({
        id: request.id,
        error: {
          code: requestError.code,
          message: requestError.message,
          ...(requestError.data === undefined ? {} : { data: requestError.data }),
        },
      });
    }
  }

  private reportUnhandledError(error: Error): void {
    if (this.options.onUnhandledError) this.options.onUnhandledError(error);
    else queueMicrotask(() => {
      throw error;
    });
  }
}

function classifyMessage(value: unknown): JsonRpcMessage {
  if (!isRecord(value)) throw new AppServerProtocolError("JSON-RPC payload must be an object.");

  if (Object.hasOwn(value, "method")) {
    if (typeof value.method !== "string" || value.method.length === 0) {
      throw new AppServerProtocolError("JSON-RPC method must be a non-empty string.");
    }
    if (Object.hasOwn(value, "id")) {
      if (!isRequestId(value.id)) throw new AppServerProtocolError("JSON-RPC request id is invalid.");
      return {
        id: value.id,
        method: value.method,
        ...(Object.hasOwn(value, "params") ? { params: value.params as JsonValue } : {}),
      };
    }
    return {
      method: value.method,
      ...(Object.hasOwn(value, "params") ? { params: value.params as JsonValue } : {}),
    };
  }

  if (!isRequestId(value.id)) throw new AppServerProtocolError("JSON-RPC response id is invalid.");
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) {
    throw new AppServerProtocolError("JSON-RPC response must contain exactly one of result or error.");
  }
  if (hasError) {
    const error = value.error;
    if (!isRecord(error) || typeof error.code !== "number" || typeof error.message !== "string") {
      throw new AppServerProtocolError("JSON-RPC error response is malformed.");
    }
    return {
      id: value.id,
      error: {
        code: error.code,
        message: error.message,
        ...(Object.hasOwn(error, "data") ? { data: error.data as JsonValue } : {}),
      },
    };
  }
  return { id: value.id, result: value.result as JsonValue };
}

function validateRequestOptions(options: RequestOptions): void {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  ) {
    throw new RangeError("timeoutMs must be a finite non-negative number.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return (
    typeof value === "string" ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function stringifyJsonPreservingBigInts(value: unknown): string {
  for (;;) {
    const prefix = `__codex_app_server_bigint_${randomUUID()}_`;
    const markers: Array<{ literal: string; marker: string }> = [];
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item !== "bigint") return item;
      const marker = `${prefix}${markers.length}__`;
      markers.push({ literal: item.toString(), marker });
      return marker;
    });
    if (serialized === undefined) {
      throw new TypeError("JSON value serialized to undefined.");
    }

    const replacements = markers.map(({ literal, marker }) => ({
      literal,
      quotedMarker: JSON.stringify(marker),
    }));
    if (
      replacements.some(
        ({ quotedMarker }) => countOccurrences(serialized, quotedMarker) !== 1,
      )
    ) {
      continue;
    }

    return replacements.reduce(
      (output, { literal, quotedMarker }) => output.replace(quotedMarker, literal),
      serialized,
    );
  }
}

function parseJsonPreservingLargeIntegers(source: string): unknown {
  let prefix = `__codex_app_server_bigint_${randomUUID()}_`;
  while (source.includes(prefix)) prefix = `__codex_app_server_bigint_${randomUUID()}_`;
  const transformed = quoteUnsafeIntegerTokens(source, prefix);
  return JSON.parse(transformed, (_key, value: unknown) => {
    if (typeof value !== "string" || !value.startsWith(prefix)) return value;
    const literal = value.slice(prefix.length);
    return /^-?\d+$/.test(literal) ? BigInt(literal) : value;
  });
}

function quoteUnsafeIntegerTokens(source: string, prefix: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === '"') {
      const end = endOfJsonString(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    const match = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) {
      output += source[index];
      index += 1;
      continue;
    }

    const token = match[0];
    output +=
      !/[.eE]/.test(token) && !isSafeIntegerLiteral(token)
        ? JSON.stringify(`${prefix}${token}`)
        : token;
    index += token.length;
  }
  return output;
}

function endOfJsonString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === '"') return index + 1;
    else index += 1;
  }
  return source.length;
}

function isSafeIntegerLiteral(value: string): boolean {
  const integer = BigInt(value);
  return (
    integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}

function countOccurrences(source: string, search: string): number {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(search, index)) >= 0) {
    count += 1;
    index += search.length;
  }
  return count;
}
