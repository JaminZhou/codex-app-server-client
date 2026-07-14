import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
});
