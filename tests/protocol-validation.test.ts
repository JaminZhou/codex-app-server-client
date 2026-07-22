import { describe, expect, it, vi } from "vitest";
import {
  AppServerProtocolValidationError,
  CodexAppServerClient,
  protocolValidationMetadata,
} from "../src";
import { loadProtocolValidator } from "../src/protocol-validator";
import type { JsonRpcNotification } from "../src/types";
import { FakeAppServer } from "./fake-app-server";

describe("generated protocol runtime validation", () => {
  it("validates generated request and response schemas without losing bigint values", async () => {
    const validator = await loadProtocolValidator();
    expect(() =>
      validator.assertClientRequest("thread/list", { limit: "not-an-integer" }),
    ).toThrow(AppServerProtocolValidationError);
    expect(() =>
      validator.assertClientRequest("thread/list", { limit: 4_294_967_295 }),
    ).not.toThrow();
    for (const limit of [4_294_967_296, 9_007_199_254_740_993n]) {
      expect(() => validator.assertClientRequest("thread/list", { limit })).toThrow(
        AppServerProtocolValidationError,
      );
    }
    expect(() =>
      validator.assertClientRequest("mcpServer/oauth/login", {
        name: "server",
        timeoutSecs: (1n << 63n) - 1n,
      }),
    ).not.toThrow();
    for (const timeoutSecs of [Number.MAX_SAFE_INTEGER + 1, 1n << 63n]) {
      expect(() =>
        validator.assertClientRequest("mcpServer/oauth/login", {
          name: "server",
          timeoutSecs,
        }),
      ).toThrow(AppServerProtocolValidationError);
    }
    expect(() =>
      validator.assertClientRequest("command/exec/resize", {
        processId: "process-1",
        size: { cols: 65_535, rows: 65_535 },
      }),
    ).not.toThrow();
    expect(() =>
      validator.assertClientRequest("command/exec/resize", {
        processId: "process-1",
        size: { cols: 65_536, rows: 1 },
      }),
    ).toThrow(AppServerProtocolValidationError);
    for (const [method, params] of [
      [
        "command/exec",
        { command: ["true"], outputBytesCap: (1n << 64n) - 1n },
      ],
      [
        "environment/add",
        {
          connectTimeoutMs: (1n << 64n) - 1n,
          environmentId: "environment-1",
          execServerUrl: "wss://example.test",
        },
      ],
    ] as const) {
      expect(() => validator.assertClientRequest(method, params)).not.toThrow();
    }
    expect(() =>
      validator.assertClientRequest("environment/add", {
        connectTimeoutMs: 1n << 64n,
        environmentId: "environment-1",
        execServerUrl: "wss://example.test",
      }),
    ).toThrow(AppServerProtocolValidationError);
    expect(() =>
      validator.assertResponse("command/exec", {
        exitCode: 2_147_483_647,
        stderr: "",
        stdout: "",
      }),
    ).not.toThrow();
    expect(() =>
      validator.assertResponse("command/exec", {
        exitCode: 2_147_483_648,
        stderr: "",
        stdout: "",
      }),
    ).toThrow(AppServerProtocolValidationError);
    expect(() =>
      validator.assertResponse("remoteControl/pairing/start", {
        pairingCode: "PAIR",
        manualPairingCode: null,
        environmentId: "environment-1",
        expiresAt: 9_007_199_254_740_993n,
      }),
    ).not.toThrow();
    expect(() =>
      validator.assertServerRequest({
        id: "elicitation",
        method: "mcpServer/elicitation/request",
        params: {
          message: "Provide a number",
          mode: "form",
          requestedSchema: {
            properties: {
              value: { maximum: 1e100, minimum: 1e16, type: "number" },
            },
            required: ["value"],
            type: "object",
          },
          serverName: "server",
          threadId: "thread-1",
        },
      }),
    ).not.toThrow();
    expect(() => validator.assertClientRequest("future/request", { arbitrary: true })).not.toThrow();
    expect(protocolValidationMetadata).toMatchObject({
      defaultMode: "strict",
      validatedClientNotifications: 1,
      validatedClientRequests: 129,
      validatedClientResponses: 126,
      validatedServerNotifications: 72,
      validatedServerRequests: 11,
      unavailableResponseSchemas: [
        "getAuthStatus",
        "getConversationSummary",
        "gitDiffToRemote",
      ],
    });
  });

  it("rejects malformed known requests before writing them", async () => {
    const server = await FakeAppServer.listen(() => undefined);
    const client = new CodexAppServerClient({
      transport: { type: "websocket", url: server.url },
    });

    try {
      await client.connect();
      await expect(
        Promise.resolve().then(() =>
          client.request("thread/list", { limit: "not-an-integer" }),
        ),
      ).rejects.toMatchObject({
        direction: "request",
        method: "thread/list",
      });
      expect(server.messages.filter((message) => message.method === "thread/list")).toHaveLength(
        0,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a malformed known response and closes the mismatched connection", async () => {
    const server = await FakeAppServer.listen((message, appServer) => {
      if (message.method === "thread/list") {
        appServer.reply(message, { data: "not-an-array", nextCursor: null });
      }
    });
    const observed: Error[] = [];
    const client = new CodexAppServerClient({
      transport: { type: "websocket", url: server.url },
    });
    client.onError((error) => observed.push(error));

    await client.connect();
    await expect(client.threadList({ limit: 1 })).rejects.toMatchObject({
      direction: "response",
      method: "thread/list",
    });
    await vi.waitFor(() => expect(client.state).toBe("disconnected"));
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeInstanceOf(AppServerProtocolValidationError);
    await client.close();
    await server.close();
  });

  it("closes for malformed known notifications but forwards unknown extensions", async () => {
    const server = await FakeAppServer.listen(() => undefined);
    const observed: Error[] = [];
    const notifications: JsonRpcNotification[] = [];
    const client = new CodexAppServerClient({
      transport: { type: "websocket", url: server.url },
    });
    client.onError((error) => observed.push(error));
    client.onNotification((notification) => {
      notifications.push(notification);
    });

    await client.connect();
    server.notify("future/notification", { arbitrary: true });
    await vi.waitFor(() => expect(notifications).toHaveLength(1));
    expect(client.state).toBe("connected");

    server.notify("turn/started", { threadId: "thread-1" });
    await vi.waitFor(() => expect(client.state).toBe("disconnected"));
    expect(observed[0]).toMatchObject({
      direction: "notification",
      method: "turn/started",
    });
    await client.close();
    await server.close();
  });

  it("returns JSON-RPC errors for malformed server requests and handler responses", async () => {
    const server = await FakeAppServer.listen(() => undefined);
    let handled = 0;
    const client = new CodexAppServerClient({
      transport: { type: "websocket", url: server.url },
    });
    client.onServerRequest(() => {
      handled += 1;
      return { invalid: true };
    });

    try {
      await client.connect();
      server.request("invalid-params", "currentTime/read", {});
      await vi.waitFor(() =>
        expect(server.messages.find((message) => message.id === "invalid-params")).toMatchObject({
          error: { code: -32602 },
        }),
      );
      expect(handled).toBe(0);

      server.request("invalid-result", "currentTime/read", { threadId: "thread-1" });
      await vi.waitFor(() =>
        expect(server.messages.find((message) => message.id === "invalid-result")).toMatchObject({
          error: { code: -32603 },
        }),
      );
      expect(handled).toBe(1);
      expect(client.state).toBe("connected");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("allows validation to be disabled for deliberate version-skew experiments", async () => {
    const server = await FakeAppServer.listen((message, appServer) => {
      if (message.method === "thread/list") {
        appServer.reply(message, { data: "future-shape" });
      }
    });
    const client = new CodexAppServerClient({
      protocolValidation: "off",
      transport: { type: "websocket", url: server.url },
    });

    try {
      await client.connect();
      await expect(client.request("thread/list", { limit: 1 })).resolves.toEqual({
        data: "future-shape",
      });
      expect(client.state).toBe("connected");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
