import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  protocolMetadata,
  resolveCodexBinary,
} from "../src";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("codex app-server integration", () => {
  it("resolves the version-matched local CLI package", () => {
    const resolved = resolveCodexBinary();
    const version = execFileSync(resolved.executablePath, ["--version"], { encoding: "utf8" });
    expect(version.trim()).toBe(`codex-cli ${protocolMetadata.codexCliVersion}`);
  });

  it("fails fast when an explicit Codex binary cannot be spawned", async () => {
    const observed: Error[] = [];
    const client = new CodexAppServerClient({
      codexPath: "/definitely/missing/codex",
    });
    client.onError((error) => observed.push(error));

    await expect(client.connect()).rejects.toMatchObject({ code: "ENOENT" });
    expect(client.state).toBe("disconnected");
    expect(observed).toHaveLength(1);
  });

  it(
    "closes safely during startup and serializes a requested reconnect",
    async () => {
      const codexHome = mkdtempSync(join(tmpdir(), "codex-app-server-client-race-test-"));
      temporaryDirectories.push(codexHome);
      const client = new CodexAppServerClient({
        env: { CODEX_HOME: codexHome },
        requestTimeoutMs: 10_000,
      });

      const initialConnection = client.connect();
      const initialOutcome = initialConnection.then(
        () => null,
        (error: unknown) => error,
      );
      const closing = client.close();
      const reconnected = client.connect();

      await closing;
      expect(await initialOutcome).toBeInstanceOf(Error);
      const initialization = await reconnected;
      expect(realpathSync(initialization.codexHome)).toBe(realpathSync(codexHome));
      expect(client.state).toBe("connected");
      await client.close();
      expect(client.state).toBe("disconnected");
    },
    20_000,
  );

  it(
    "initializes over stdio and performs a typed-protocol request",
    async () => {
      const codexHome = mkdtempSync(join(tmpdir(), "codex-app-server-client-test-"));
      temporaryDirectories.push(codexHome);
      const client = new CodexAppServerClient({
        env: { CODEX_HOME: codexHome },
        requestTimeoutMs: 10_000,
      });

      try {
        const firstConnection = client.connect();
        const secondConnection = client.connect();
        expect(secondConnection).toBe(firstConnection);
        const initialization = await firstConnection;
        expect(initialization.userAgent).toContain("codex");
        expect(realpathSync(initialization.codexHome)).toBe(realpathSync(codexHome));
        expect(client.state).toBe("connected");

        const response = await client.call("thread/list", { limit: 1 });
        expect(response.data).toEqual([]);
        expect(response.nextCursor).toBeNull();

        const thread = await client.createThread({ cwd: codexHome });
        expect(thread.id).toMatch(/^[0-9a-f-]+$/i);
        const read = await thread.read();
        expect(read.thread.id).toBe(thread.id);
        await expect(thread.setName("integration test")).resolves.toEqual({});
      } finally {
        await client.close();
      }
      expect(client.state).toBe("disconnected");
    },
    20_000,
  );

  it(
    "initializes through the real app-server Unix control socket",
    async () => {
      const codexHome = mkdtempSync(join(tmpdir(), "codex-app-server-client-unix-test-"));
      temporaryDirectories.push(codexHome);
      const socketPath = join(codexHome, "control.sock");
      const resolved = resolveCodexBinary();
      const child = spawn(
        resolved.executablePath,
        ["app-server", "--listen", `unix://${socketPath}`],
        {
          env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: "warn" },
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const client = new CodexAppServerClient({
        requestTimeoutMs: 10_000,
        transport: { type: "unix", socketPath },
      });

      try {
        await waitForSocket(child, socketPath, () => stderr);
        const initialization = await client.connect();
        expect(realpathSync(initialization.codexHome)).toBe(realpathSync(codexHome));
        expect(client.state).toBe("connected");
        await expect(client.call("thread/list", { limit: 1 })).resolves.toMatchObject({
          data: [],
          nextCursor: null,
        });
      } finally {
        await client.close();
        await stopChild(child);
      }
      expect(client.state).toBe("disconnected");
    },
    20_000,
  );

  it(
    "initializes through the real experimental TCP WebSocket listener",
    async () => {
      const codexHome = mkdtempSync(join(tmpdir(), "codex-app-server-client-ws-test-"));
      temporaryDirectories.push(codexHome);
      const port = await availableTcpPort();
      const listenUrl = `ws://127.0.0.1:${port}`;
      const resolved = resolveCodexBinary();
      const child = spawn(resolved.executablePath, ["app-server", "--listen", listenUrl], {
        env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: "warn" },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const client = new CodexAppServerClient({
        requestTimeoutMs: 10_000,
        transport: { type: "websocket", url: listenUrl },
      });

      try {
        await waitForReady(child, port, () => stderr);
        const initialization = await client.connect();
        expect(realpathSync(initialization.codexHome)).toBe(realpathSync(codexHome));
        await expect(client.call("thread/list", { limit: 1 })).resolves.toMatchObject({
          data: [],
          nextCursor: null,
        });
      } finally {
        await client.close();
        await stopChild(child);
      }
    },
    20_000,
  );
});

async function waitForSocket(
  child: ChildProcess,
  socketPath: string,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`codex app-server exited before creating its socket.\n${stderr()}`);
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for codex app-server socket ${socketPath}.\n${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let exited = once(child, "exit").then(() => undefined);
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  exited = once(child, "exit").then(() => undefined);
  child.kill("SIGKILL");
  await Promise.race([exited, delay(500)]);
}

async function availableTcpPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForReady(
  child: ChildProcess,
  port: number,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`codex app-server exited before becoming ready.\n${stderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return;
    } catch {
      // Listener startup is asynchronous; retry until the bounded deadline.
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for codex app-server readiness.\n${stderr()}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
