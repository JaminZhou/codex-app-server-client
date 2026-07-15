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
      validator.assertResponse("remoteControl/pairing/start", {
        pairingCode: "PAIR",
        manualPairingCode: null,
        environmentId: "environment-1",
        expiresAt: 9_007_199_254_740_993n,
      }),
    ).not.toThrow();
    expect(() => validator.assertClientRequest("future/request", { arbitrary: true })).not.toThrow();
    expect(protocolValidationMetadata).toMatchObject({
      defaultMode: "strict",
      validatedClientNotifications: 1,
      validatedClientRequests: 125,
      validatedClientResponses: 122,
      validatedServerNotifications: 69,
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
