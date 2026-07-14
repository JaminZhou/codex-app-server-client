import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { AppServerConnectionClosedError } from "./errors";
import { JsonlRpcPeer } from "./jsonl-rpc-peer";
import type {
  ClientInfo,
  InitializeCapabilities,
  InitializeResponse,
  JsonValue,
  NotificationHandler,
  ServerRequestHandler,
} from "./types";

export interface CodexAppServerClientOptions {
  capabilities?: InitializeCapabilities;
  clientInfo?: ClientInfo;
  codexPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CLIENT_INFO: ClientInfo = {
  name: "codex_app_server_client_ts",
  title: "Codex App Server Client for TypeScript",
  version: "0.0.0",
};

export class CodexAppServerClient {
  private readonly options: CodexAppServerClientOptions;
  private process: ChildProcessWithoutNullStreams | null = null;
  private peer: JsonlRpcPeer | null = null;
  private stderr = "";
  private initializeResponse: InitializeResponse | null = null;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.options = options;
  }

  get initialization(): InitializeResponse | null {
    return this.initializeResponse;
  }

  async connect(): Promise<InitializeResponse> {
    if (this.initializeResponse) return this.initializeResponse;
    if (this.process) {
      throw new Error("The codex app-server connection is already starting.");
    }

    const process = spawn(
      this.options.codexPath ?? "codex",
      ["app-server", "--listen", "stdio://"],
      {
        cwd: this.options.cwd,
        env: { ...globalThis.process.env, ...this.options.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.process = process;
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });

    try {
      await once(process, "spawn");
      this.peer = new JsonlRpcPeer(process.stdout, process.stdin);
      process.once("exit", (code, signal) => {
        const detail = this.stderr.trim();
        const suffix = detail ? `\n${detail}` : "";
        this.peer?.dispose(
          new AppServerConnectionClosedError(
            `codex app-server exited (${signal ?? code ?? "unknown"}).${suffix}`,
          ),
        );
        this.peer = null;
        this.process = null;
        this.initializeResponse = null;
      });

      const response = await this.peer.request<InitializeResponse>("initialize", {
        capabilities: {
          ...(this.options.capabilities ?? { experimentalApi: false }),
        },
        clientInfo: {
          ...(this.options.clientInfo ?? DEFAULT_CLIENT_INFO),
        },
      });
      this.peer.notify("initialized", {});
      this.initializeResponse = response;
      return response;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  request<T = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    return this.requirePeer().request<T>(method, params);
  }

  notify(method: string, params?: JsonValue): void {
    this.requirePeer().notify(method, params);
  }

  onNotification(handler: NotificationHandler): () => void {
    return this.requirePeer().onNotification(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    return this.requirePeer().onServerRequest(handler);
  }

  async close(): Promise<void> {
    const process = this.process;
    this.initializeResponse = null;
    this.peer?.dispose();
    this.peer = null;
    this.process = null;
    if (!process) return;

    process.stdin.end();
    if (process.exitCode === null && process.signalCode === null) {
      process.kill("SIGTERM");
    }
    await Promise.race([
      once(process, "exit").catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (process.exitCode === null && process.signalCode === null) {
      process.kill("SIGKILL");
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
