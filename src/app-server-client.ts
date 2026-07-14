import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { prependPathDirectories, resolveCodexBinary } from "./codex-binary";
import {
  AppServerConnectionClosedError,
  AppServerProtocolError,
  AppServerServerRequestError,
} from "./errors";
import type {
  AppServerMethod,
  AppServerParams,
  AppServerResponseMap,
} from "./generated/app-server-methods";
import type { ClientInfo } from "./generated/protocol/ClientInfo";
import type { InitializeCapabilities } from "./generated/protocol/InitializeCapabilities";
import type { InitializeResponse } from "./generated/protocol/InitializeResponse";
import type { ServerNotification } from "./generated/protocol/ServerNotification";
import type { ModelListParams } from "./generated/protocol/v2/ModelListParams";
import type { ModelListResponse } from "./generated/protocol/v2/ModelListResponse";
import type { ThreadArchiveParams } from "./generated/protocol/v2/ThreadArchiveParams";
import type { ThreadArchiveResponse } from "./generated/protocol/v2/ThreadArchiveResponse";
import type { ThreadCompactStartParams } from "./generated/protocol/v2/ThreadCompactStartParams";
import type { ThreadCompactStartResponse } from "./generated/protocol/v2/ThreadCompactStartResponse";
import type { ThreadForkParams } from "./generated/protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "./generated/protocol/v2/ThreadForkResponse";
import type { ThreadListParams } from "./generated/protocol/v2/ThreadListParams";
import type { ThreadListResponse } from "./generated/protocol/v2/ThreadListResponse";
import type { ThreadReadParams } from "./generated/protocol/v2/ThreadReadParams";
import type { ThreadReadResponse } from "./generated/protocol/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "./generated/protocol/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "./generated/protocol/v2/ThreadResumeResponse";
import type { ThreadSetNameParams } from "./generated/protocol/v2/ThreadSetNameParams";
import type { ThreadSetNameResponse } from "./generated/protocol/v2/ThreadSetNameResponse";
import type { ThreadStartParams } from "./generated/protocol/v2/ThreadStartParams";
import type { ThreadStartResponse } from "./generated/protocol/v2/ThreadStartResponse";
import type { ThreadUnarchiveParams } from "./generated/protocol/v2/ThreadUnarchiveParams";
import type { ThreadUnarchiveResponse } from "./generated/protocol/v2/ThreadUnarchiveResponse";
import type { TurnInterruptParams } from "./generated/protocol/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "./generated/protocol/v2/TurnInterruptResponse";
import type { TurnStartParams } from "./generated/protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "./generated/protocol/v2/TurnStartResponse";
import type { TurnSteerParams } from "./generated/protocol/v2/TurnSteerParams";
import type { TurnSteerResponse } from "./generated/protocol/v2/TurnSteerResponse";
import { JsonlRpcPeer } from "./jsonl-rpc-peer";
import {
  CodexThread,
  CodexTurn,
  normalizeTurnInput,
  type CodexTurnInput,
  type CodexTurnStartOptions,
} from "./thread";
import type {
  ServerNotificationMethod,
  ServerRequestMethod,
  TypedNotificationHandler,
  TypedServerRequestHandler,
} from "./typed-handlers";
import type {
  JsonValue,
  NotificationHandler,
  RequestOptions,
  ServerRequestHandler,
} from "./types";
import { TurnEventRouter } from "./turn-event-router";

export type AppServerConnectionState = "disconnected" | "connecting" | "connected" | "closing";
export type AppServerCallArguments<M extends AppServerMethod> = [AppServerParams<M>] extends [undefined]
  ? [params?: undefined, options?: RequestOptions]
  : [params: AppServerParams<M>, options?: RequestOptions];
type StoredTypedNotificationHandler = (
  params: unknown,
  notification: ServerNotification,
) => void | Promise<void>;

export interface CodexAppServerClientOptions {
  appServerArgs?: readonly string[];
  capabilities?: Partial<InitializeCapabilities>;
  clientInfo?: ClientInfo;
  codexPath?: string;
  configOverrides?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onUnhandledError?: (error: Error) => void;
  requestTimeoutMs?: number;
  stderrBufferLines?: number;
}

const DEFAULT_CLIENT_INFO: ClientInfo = {
  name: "codex_app_server_client_ts",
  title: "Codex App Server Client for TypeScript",
  version: "0.0.0",
};

const DEFAULT_CAPABILITIES: InitializeCapabilities = {
  experimentalApi: true,
  requestAttestation: false,
};

export class CodexAppServerClient {
  private readonly options: CodexAppServerClientOptions;
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly typedNotificationHandlers = new Map<
    string,
    Set<StoredTypedNotificationHandler>
  >();
  private readonly typedServerRequestHandlers = new Map<string, ServerRequestHandler>();
  private readonly turnEvents = new TurnEventRouter();
  private child: ChildProcessWithoutNullStreams | null = null;
  private closePromise: Promise<void> | null = null;
  private peer: JsonlRpcPeer | null = null;
  private connectPromise: Promise<InitializeResponse> | null = null;
  private initializeResponse: InitializeResponse | null = null;
  private serverRequestHandler: ServerRequestHandler | null = null;
  private stderrLines: string[] = [];
  private stderrRemainder = "";
  private currentState: AppServerConnectionState = "disconnected";

  constructor(options: CodexAppServerClientOptions = {}) {
    validateClientOptions(options);
    this.options = {
      ...options,
      appServerArgs: options.appServerArgs ? [...options.appServerArgs] : undefined,
      capabilities: options.capabilities ? { ...options.capabilities } : undefined,
      clientInfo: options.clientInfo ? { ...options.clientInfo } : undefined,
      configOverrides: options.configOverrides ? [...options.configOverrides] : undefined,
      env: options.env ? { ...options.env } : undefined,
    };
  }

  get initialization(): InitializeResponse | null {
    return this.initializeResponse;
  }

  get state(): AppServerConnectionState {
    return this.currentState;
  }

  get stderrTail(): string {
    return [...this.stderrLines, this.stderrRemainder].filter(Boolean).join("\n");
  }

  connect(): Promise<InitializeResponse> {
    if (this.initializeResponse) return Promise.resolve(this.initializeResponse);
    if (this.closePromise) {
      const closing = this.closePromise;
      return closing.then(async () => {
        const interruptedConnection = this.connectPromise;
        if (interruptedConnection) {
          await interruptedConnection.catch(() => undefined);
        }
        return this.connect();
      });
    }
    if (this.connectPromise) return this.connectPromise;
    const tracked = this.start().finally(() => {
      if (this.connectPromise === tracked) this.connectPromise = null;
    });
    this.connectPromise = tracked;
    return tracked;
  }

  request<T = JsonValue>(
    method: string,
    params?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.requirePeer().request<T>(method, params, this.withDefaultTimeout(options));
  }

  call<M extends AppServerMethod>(
    method: M,
    ...args: AppServerCallArguments<M>
  ): Promise<AppServerResponseMap[M]> {
    const [params, options = {}] = args as [unknown, RequestOptions?];
    return this.request<AppServerResponseMap[M]>(method, params, options);
  }

  threadStart(
    params: ThreadStartParams = {},
    options: RequestOptions = {},
  ): Promise<ThreadStartResponse> {
    return this.request("thread/start", params, options);
  }

  threadResume(
    params: ThreadResumeParams,
    options: RequestOptions = {},
  ): Promise<ThreadResumeResponse> {
    return this.request("thread/resume", params, options);
  }

  threadFork(
    params: ThreadForkParams,
    options: RequestOptions = {},
  ): Promise<ThreadForkResponse> {
    return this.request("thread/fork", params, options);
  }

  threadList(
    params: ThreadListParams = {},
    options: RequestOptions = {},
  ): Promise<ThreadListResponse> {
    return this.request("thread/list", params, options);
  }

  threadRead(
    params: ThreadReadParams,
    options: RequestOptions = {},
  ): Promise<ThreadReadResponse> {
    return this.request("thread/read", params, options);
  }

  threadArchive(
    params: ThreadArchiveParams,
    options: RequestOptions = {},
  ): Promise<ThreadArchiveResponse> {
    return this.request("thread/archive", params, options);
  }

  threadUnarchive(
    params: ThreadUnarchiveParams,
    options: RequestOptions = {},
  ): Promise<ThreadUnarchiveResponse> {
    return this.request("thread/unarchive", params, options);
  }

  threadSetName(
    params: ThreadSetNameParams,
    options: RequestOptions = {},
  ): Promise<ThreadSetNameResponse> {
    return this.request("thread/name/set", params, options);
  }

  threadCompact(
    params: ThreadCompactStartParams,
    options: RequestOptions = {},
  ): Promise<ThreadCompactStartResponse> {
    return this.request("thread/compact/start", params, options);
  }

  turnStart(
    params: TurnStartParams,
    options: RequestOptions = {},
  ): Promise<TurnStartResponse> {
    return this.request("turn/start", params, options);
  }

  turnSteer(
    params: TurnSteerParams,
    options: RequestOptions = {},
  ): Promise<TurnSteerResponse> {
    return this.request("turn/steer", params, options);
  }

  turnInterrupt(
    params: TurnInterruptParams,
    options: RequestOptions = {},
  ): Promise<TurnInterruptResponse> {
    return this.request("turn/interrupt", params, options);
  }

  modelList(
    params: ModelListParams = {},
    options: RequestOptions = {},
  ): Promise<ModelListResponse> {
    return this.request("model/list", params, options);
  }

  async createThread(
    params: ThreadStartParams = {},
    options: RequestOptions = {},
  ): Promise<CodexThread> {
    const response = await this.threadStart(params, options);
    return new CodexThread(this, response.thread);
  }

  async resumeThread(
    threadId: string,
    params: Omit<ThreadResumeParams, "threadId"> = {},
    options: RequestOptions = {},
  ): Promise<CodexThread> {
    const response = await this.threadResume({ ...params, threadId }, options);
    return new CodexThread(this, response.thread);
  }

  async forkThread(
    threadId: string,
    params: Omit<ThreadForkParams, "threadId"> = {},
    options: RequestOptions = {},
  ): Promise<CodexThread> {
    const response = await this.threadFork({ ...params, threadId }, options);
    return new CodexThread(this, response.thread);
  }

  async startTurn(
    threadId: string,
    input: CodexTurnInput,
    params: CodexTurnStartOptions = {},
    options: RequestOptions = {},
  ): Promise<CodexTurn> {
    const response = await this.turnStart(
      { ...params, threadId, input: normalizeTurnInput(input) },
      options,
    );
    return new CodexTurn(this, threadId, response.turn.id, this.turnEvents.open(response.turn.id));
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.requirePeer().notify(method, params);
  }

  onNotification(handler: NotificationHandler): () => void;
  onNotification<M extends ServerNotificationMethod>(
    method: M,
    handler: TypedNotificationHandler<M>,
  ): () => void;
  onNotification<M extends ServerNotificationMethod>(
    methodOrHandler: M | NotificationHandler,
    typedHandler?: TypedNotificationHandler<M>,
  ): () => void {
    if (typeof methodOrHandler === "function") {
      this.notificationHandlers.add(methodOrHandler);
      return () => this.notificationHandlers.delete(methodOrHandler);
    }
    if (typeof typedHandler !== "function") {
      throw new TypeError("A notification handler is required when registering by method.");
    }
    const handlers = this.typedNotificationHandlers.get(methodOrHandler) ?? new Set();
    const handler: StoredTypedNotificationHandler = (params, notification) =>
      typedHandler(
        params as Parameters<TypedNotificationHandler<M>>[0],
        notification as Parameters<TypedNotificationHandler<M>>[1],
      );
    handlers.add(handler);
    this.typedNotificationHandlers.set(methodOrHandler, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.typedNotificationHandlers.delete(methodOrHandler);
    };
  }

  onServerRequest(handler: ServerRequestHandler): () => void;
  onServerRequest<M extends ServerRequestMethod>(
    method: M,
    handler: TypedServerRequestHandler<M>,
  ): () => void;
  onServerRequest<M extends ServerRequestMethod>(
    methodOrHandler: M | ServerRequestHandler,
    typedHandler?: TypedServerRequestHandler<M>,
  ): () => void {
    if (typeof methodOrHandler !== "function") {
      if (typeof typedHandler !== "function") {
        throw new TypeError("A server-request handler is required when registering by method.");
      }
      const handler: ServerRequestHandler = (request) =>
        typedHandler(
          request.params as Parameters<TypedServerRequestHandler<M>>[0],
          request as Parameters<TypedServerRequestHandler<M>>[1],
        );
      this.typedServerRequestHandlers.set(methodOrHandler, handler);
      return () => {
        if (this.typedServerRequestHandlers.get(methodOrHandler) === handler) {
          this.typedServerRequestHandlers.delete(methodOrHandler);
        }
      };
    }
    const handler = methodOrHandler;
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) this.serverRequestHandler = null;
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const tracked = this.stop().finally(() => {
      if (this.closePromise === tracked) this.closePromise = null;
    });
    this.closePromise = tracked;
    return tracked;
  }

  private async stop(): Promise<void> {
    const child = this.child;
    this.currentState = "closing";
    this.initializeResponse = null;
    this.turnEvents.failAll(
      new AppServerConnectionClosedError("The client closed the codex app-server connection."),
    );
    this.peer?.dispose();
    this.peer = null;
    this.child = null;
    if (!child) {
      this.currentState = "disconnected";
      return;
    }

    if (child.pid === undefined && isRunning(child)) {
      await Promise.race([
        once(child, "spawn").then(() => undefined).catch(() => undefined),
        once(child, "close").then(() => undefined).catch(() => undefined),
        delay(2_000),
      ]);
    }

    if (child.stdin.writable) child.stdin.end();
    if (isRunning(child)) {
      const exited = once(child, "exit").then(() => undefined).catch(() => undefined);
      if (child.pid !== undefined) child.kill("SIGTERM");
      await Promise.race([exited, delay(2_000)]);
    }
    if (isRunning(child)) {
      const exited = once(child, "exit").then(() => undefined).catch(() => undefined);
      child.kill("SIGKILL");
      await Promise.race([exited, delay(500)]);
    }
    this.currentState = "disconnected";
  }

  private async start(): Promise<InitializeResponse> {
    this.currentState = "connecting";
    this.stderrLines = [];
    this.stderrRemainder = "";
    try {
      const resolved = resolveCodexBinary(this.options.codexPath);
      const args: string[] = [];
      for (const override of this.options.configOverrides ?? []) {
        args.push("--config", override);
      }
      args.push("app-server", "--listen", "stdio://", ...(this.options.appServerArgs ?? []));

      const child = spawn(resolved.executablePath, args, {
        cwd: this.options.cwd,
        env: prependPathDirectories(
          { ...globalThis.process.env, ...this.options.env },
          resolved.pathDirectories,
        ),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => this.captureStderr(chunk));
      child.on("error", (error) => {
        this.reportUnhandledError(error);
        if (this.child === child) {
          this.peer?.dispose(
            new AppServerConnectionClosedError("codex app-server process failed.", {
              cause: error,
            }),
          );
        }
      });
      child.once("exit", (code, signal) => this.handleExit(child, code, signal));

      await once(child, "spawn");
      if (this.child !== child) throw new AppServerConnectionClosedError();
      const peer = new JsonlRpcPeer(child.stdout, child.stdin, {
        onUnhandledError: (error) => this.reportUnhandledError(error),
      });
      this.peer = peer;
      peer.onNotification(async (notification) => {
        this.turnEvents.route(notification);
        for (const handler of [...this.notificationHandlers]) await handler(notification);
        for (const handler of this.typedNotificationHandlers.get(notification.method) ?? []) {
          await handler(notification.params, notification as ServerNotification);
        }
      });
      peer.onServerRequest((request) => {
        const typedHandler = this.typedServerRequestHandlers.get(request.method);
        if (typedHandler) return typedHandler(request);
        if (!this.serverRequestHandler) {
          throw new AppServerServerRequestError(
            `Unsupported server request: ${request.method}`,
            -32601,
          );
        }
        return this.serverRequestHandler(request);
      });

      const response = validateInitializeResponse(
        await peer.request<unknown>(
          "initialize",
          {
            capabilities: { ...DEFAULT_CAPABILITIES, ...this.options.capabilities },
            clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
          },
          this.withDefaultTimeout({}),
        ),
      );
      await peer.notify("initialized");
      this.initializeResponse = response;
      this.currentState = "connected";
      return response;
    } catch (error) {
      const tail = this.stderrTail;
      await this.close();
      if (error instanceof AppServerConnectionClosedError && tail) {
        throw new AppServerConnectionClosedError(`${error.message}\n${tail}`, { cause: error });
      }
      throw error;
    }
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return;
    const suffix = this.stderrTail ? `\n${this.stderrTail}` : "";
    this.peer?.dispose(
      new AppServerConnectionClosedError(
        `codex app-server exited (${signal ?? code ?? "unknown"}).${suffix}`,
      ),
    );
    this.turnEvents.failAll(
      new AppServerConnectionClosedError(
        `codex app-server exited (${signal ?? code ?? "unknown"}).${suffix}`,
      ),
    );
    this.peer = null;
    this.child = null;
    this.initializeResponse = null;
    this.currentState = "disconnected";
  }

  private captureStderr(chunk: string): void {
    const lines = `${this.stderrRemainder}${chunk}`.split(/\r?\n/);
    this.stderrRemainder = lines.pop() ?? "";
    this.stderrLines.push(...lines);
    const maximum = this.options.stderrBufferLines ?? 400;
    if (this.stderrLines.length > maximum) {
      this.stderrLines.splice(0, this.stderrLines.length - maximum);
    }
  }

  private withDefaultTimeout(options: RequestOptions): RequestOptions {
    return options.timeoutMs === undefined && this.options.requestTimeoutMs !== undefined
      ? { ...options, timeoutMs: this.options.requestTimeoutMs }
      : options;
  }

  private reportUnhandledError(error: Error): void {
    try {
      this.options.onUnhandledError?.(error);
    } catch {
      // Error observers are isolated from transport processing.
    }
    for (const handler of [...this.errorHandlers]) {
      try {
        handler(error);
      } catch {
        // Error observers are isolated from each other.
      }
    }
  }

  private requirePeer(): JsonlRpcPeer {
    if (!this.peer || !this.initializeResponse) {
      throw new AppServerConnectionClosedError(
        "Call connect() before using the codex app-server client.",
      );
    }
    return this.peer;
  }
}

function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateInitializeResponse(value: unknown): InitializeResponse {
  if (!isRecord(value)) {
    throw new AppServerProtocolError("initialize response must be an object.");
  }
  for (const field of ["userAgent", "codexHome", "platformFamily", "platformOs"] as const) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      throw new AppServerProtocolError(`initialize response has invalid ${field}.`);
    }
  }
  return value as InitializeResponse;
}

function validateClientOptions(options: CodexAppServerClientOptions): void {
  if (
    options.requestTimeoutMs !== undefined &&
    (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs < 0)
  ) {
    throw new RangeError("requestTimeoutMs must be a finite non-negative number.");
  }
  if (
    options.stderrBufferLines !== undefined &&
    (!Number.isInteger(options.stderrBufferLines) || options.stderrBufferLines < 0)
  ) {
    throw new RangeError("stderrBufferLines must be a non-negative integer.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
