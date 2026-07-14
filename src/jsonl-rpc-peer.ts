import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AppServerConnectionClosedError, AppServerRpcError } from "./errors";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonValue,
  NotificationHandler,
  RequestId,
  ServerRequestHandler,
} from "./types";

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: JsonValue) => void;
}

export class JsonlRpcPeer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly reader;
  private nextId = 1;
  private closed = false;
  private serverRequestHandler: ServerRequestHandler | null = null;

  constructor(input: Readable, output: Writable) {
    this.input = input;
    this.output = output;
    this.reader = createInterface({ input, crlfDelay: Infinity });
    this.reader.on("line", (line) => {
      void this.handleLine(line);
    });
    this.input.once("error", (error) => this.dispose(error));
    this.output.once("error", (error) => this.dispose(error));
  }

  request<T = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    this.assertOpen();
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as T),
      });
      try {
        this.write({ id, method, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: JsonValue): void {
    this.assertOpen();
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
      }
    };
  }

  dispose(reason: Error = new AppServerConnectionClosedError()): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.close();
    for (const request of this.pending.values()) {
      request.reject(reason);
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    this.serverRequestHandler = null;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AppServerConnectionClosedError();
    }
  }

  private write(message: JsonRpcMessage): void {
    this.assertOpen();
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.dispose(new Error(`Invalid JSONL message: ${String(error)}`));
      return;
    }

    if ("method" in message) {
      if ("id" in message) {
        await this.handleServerRequest(message);
      } else {
        await this.handleNotification(message);
      }
      return;
    }

    this.handleResponse(message);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);

    if ("error" in response) {
      request.reject(new AppServerRpcError(response.error));
      return;
    }

    request.resolve(response.result);
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    await Promise.all(
      [...this.notificationHandlers].map(async (handler) => handler(notification)),
    );
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.serverRequestHandler) {
      this.write({
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
      this.write({ id: request.id, result });
    } catch (error) {
      this.write({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
