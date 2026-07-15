import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  AppServerBusyError,
  AppServerConnectionClosedError,
  AppServerInvalidParamsError,
  AppServerProtocolError,
  AppServerRequestAbortedError,
  AppServerRequestTimeoutError,
  AppServerServerRequestError,
  JsonlRpcPeer,
} from "../src";

function createHarness() {
  const serverToClient = new PassThrough();
  const clientToServer = new PassThrough();
  const outbound = jsonLineReader(clientToServer);
  const unhandledErrors: Error[] = [];
  let id = 0;
  const peer = new JsonlRpcPeer(serverToClient, clientToServer, {
    onUnhandledError: (error) => unhandledErrors.push(error),
    requestIdFactory: () => `request-${++id}`,
  });
  return { clientToServer, outbound, peer, serverToClient, unhandledErrors };
}

describe("JsonlRpcPeer", () => {
  it("matches concurrent responses to their request ids", async () => {
    const { outbound, peer, serverToClient } = createHarness();
    const first = peer.request("thread/read", { threadId: "thread-1" });
    const second = peer.request("thread/read", { threadId: "thread-2" });
    const firstRequest = await outbound.next();
    const secondRequest = await outbound.next();

    serverToClient.write(
      `${JSON.stringify({ id: secondRequest.id, result: { thread: { id: "thread-2" } } })}\n`,
    );
    serverToClient.write(
      `${JSON.stringify({ id: firstRequest.id, result: { thread: { id: "thread-1" } } })}\n`,
    );

    await expect(first).resolves.toEqual({ thread: { id: "thread-1" } });
    await expect(second).resolves.toEqual({ thread: { id: "thread-2" } });
    peer.dispose();
  });

  it("maps standard and overload JSON-RPC errors", async () => {
    const { outbound, peer, serverToClient } = createHarness();
    const invalid = peer.request("thread/read", {});
    const invalidRequest = await outbound.next();
    serverToClient.write(
      `${JSON.stringify({ id: invalidRequest.id, error: { code: -32602, message: "bad params" } })}\n`,
    );
    await expect(invalid).rejects.toBeInstanceOf(AppServerInvalidParamsError);

    const busy = peer.request("thread/list", {});
    const busyRequest = await outbound.next();
    serverToClient.write(
      `${JSON.stringify({ id: busyRequest.id, error: { code: -32000, message: "busy", data: { codexErrorInfo: "server_overloaded" } } })}\n`,
    );
    await expect(busy).rejects.toBeInstanceOf(AppServerBusyError);

    const ingressBusy = peer.request("thread/list", {});
    const ingressBusyRequest = await outbound.next();
    serverToClient.write(
      `${JSON.stringify({ id: ingressBusyRequest.id, error: { code: -32001, message: "Server overloaded; retry later." } })}\n`,
    );
    await expect(ingressBusy).rejects.toBeInstanceOf(AppServerBusyError);
    peer.dispose();
  });

  it("sends and preserves W3C trace context on JSON-RPC requests", async () => {
    const { outbound, peer, serverToClient } = createHarness();
    const response = peer.request("thread/read", { threadId: "thread-1" }, {
      trace: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
      },
    });
    const request = await outbound.next();
    expect(request.trace).toEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
    serverToClient.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
    await expect(response).resolves.toEqual({});

    let observedTrace: unknown;
    peer.onServerRequest((serverRequest) => {
      observedTrace = serverRequest.trace;
      return {};
    });
    serverToClient.write(
      `${JSON.stringify({ id: 10, method: "example/request", trace: { traceparent: null } })}\n`,
    );
    await outbound.next();
    expect(observedTrace).toEqual({ traceparent: null });

    expect(() =>
      peer.request("invalid", {}, { trace: { traceparent: 3 } } as never),
    ).toThrow(AppServerProtocolError);
    peer.dispose();
  });

  it("delivers notifications in transport order", async () => {
    const { peer, serverToClient, unhandledErrors } = createHarness();
    const events: string[] = [];
    peer.onNotification(async (notification) => {
      if (notification.method === "first") await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(notification.method);
    });

    serverToClient.write(`${JSON.stringify({ method: "first", params: {} })}\n`);
    serverToClient.write(`${JSON.stringify({ method: "second", params: {} })}\n`);
    await vi.waitFor(() => expect(events).toEqual(["first", "second"]));
    expect(unhandledErrors).toEqual([]);
    peer.dispose();
  });

  it("responds to server requests and preserves explicit handler errors", async () => {
    const { outbound, peer, serverToClient } = createHarness();
    peer.onServerRequest((request) => {
      if (request.method === "approval") return { decision: "accept" };
      throw new AppServerServerRequestError("not allowed", -32602, { field: "method" });
    });

    serverToClient.write(`${JSON.stringify({ id: 7, method: "approval", params: {} })}\n`);
    await expect(outbound.next()).resolves.toEqual({ id: 7, result: { decision: "accept" } });
    serverToClient.write(`${JSON.stringify({ id: 8, method: "other", params: {} })}\n`);
    await expect(outbound.next()).resolves.toEqual({
      id: 8,
      error: { code: -32602, message: "not allowed", data: { field: "method" } },
    });
    peer.dispose();
  });

  it("returns method-not-found when no server request handler is installed", async () => {
    const { outbound, peer, serverToClient } = createHarness();
    serverToClient.write(`${JSON.stringify({ id: 9, method: "approval", params: {} })}\n`);
    await expect(outbound.next()).resolves.toEqual({
      id: 9,
      error: { code: -32601, message: "Unsupported server request: approval" },
    });
    peer.dispose();
  });

  it("supports request timeouts and abort signals", async () => {
    const { outbound, peer } = createHarness();
    const timedOut = peer.request("slow", {}, { timeoutMs: 5 });
    await outbound.next();
    await expect(timedOut).rejects.toBeInstanceOf(AppServerRequestTimeoutError);

    const controller = new AbortController();
    const aborted = peer.request("cancelled", {}, { signal: controller.signal });
    await outbound.next();
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toBeInstanceOf(AppServerRequestAbortedError);
    peer.dispose();
  });

  it("preserves bigint precision in both JSONL directions", async () => {
    const { clientToServer, outbound, peer, serverToClient } = createHarness();
    await peer.notify("example", { timeout: 5n });
    await expect(outbound.next()).resolves.toEqual({ method: "example", params: { timeout: 5 } });

    const rawOutput = new Promise<string>((resolve) => {
      clientToServer.once("data", (chunk: string | Buffer) => resolve(chunk.toString()));
    });
    await peer.notify("example", { timeout: 9_007_199_254_740_993n });
    expect(await rawOutput).toContain('"timeout":9007199254740993');
    await outbound.next();

    const response = peer.request<{ literal: string; value: bigint }>("example/read");
    const request = await outbound.next();
    serverToClient.write(
      `{"id":${JSON.stringify(request.id)},"result":{"value":9007199254740993,"literal":"9007199254740993"}}\n`,
    );
    await expect(response).resolves.toEqual({
      literal: "9007199254740993",
      value: 9_007_199_254_740_993n,
    });
    peer.dispose();
  });

  it("fails all pending requests on invalid JSON or transport closure", async () => {
    const invalidHarness = createHarness();
    const invalid = invalidHarness.peer.request("thread/read", {});
    await invalidHarness.outbound.next();
    invalidHarness.serverToClient.write("not-json\n");
    await expect(invalid).rejects.toBeInstanceOf(AppServerProtocolError);

    const closedHarness = createHarness();
    const closed = closedHarness.peer.request("thread/read", {});
    await closedHarness.outbound.next();
    closedHarness.serverToClient.end();
    await expect(closed).rejects.toBeInstanceOf(AppServerConnectionClosedError);
  });
});

function jsonLineReader(stream: PassThrough) {
  const values: Record<string, unknown>[] = [];
  const waiters: Array<(value: Record<string, unknown>) => void> = [];
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else values.push(value);
    }
  });
  return {
    next: () => {
      const value = values.shift();
      if (value) return Promise.resolve(value);
      return new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve));
    },
  };
}
