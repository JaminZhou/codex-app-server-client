import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonlRpcPeer } from "../src";

function readNextJson(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    stream.once("data", (chunk) => {
      resolve(JSON.parse(chunk.toString("utf8").trim()) as Record<string, unknown>);
    });
  });
}

describe("JsonlRpcPeer", () => {
  it("matches responses to requests", async () => {
    const serverToClient = new PassThrough();
    const clientToServer = new PassThrough();
    const peer = new JsonlRpcPeer(serverToClient, clientToServer);

    const outbound = readNextJson(clientToServer);
    const result = peer.request("thread/read", { threadId: "thread-1" });
    const request = await outbound;

    serverToClient.write(
      `${JSON.stringify({ id: request.id, result: { thread: { id: "thread-1" } } })}\n`,
    );

    await expect(result).resolves.toEqual({ thread: { id: "thread-1" } });
    peer.dispose();
  });

  it("routes notifications", async () => {
    const serverToClient = new PassThrough();
    const clientToServer = new PassThrough();
    const peer = new JsonlRpcPeer(serverToClient, clientToServer);
    const notifications: string[] = [];

    peer.onNotification((notification) => {
      notifications.push(notification.method);
    });
    serverToClient.write(`${JSON.stringify({ method: "turn/started", params: {} })}\n`);

    await new Promise((resolve) => setImmediate(resolve));
    expect(notifications).toEqual(["turn/started"]);
    peer.dispose();
  });

  it("responds to server requests", async () => {
    const serverToClient = new PassThrough();
    const clientToServer = new PassThrough();
    const peer = new JsonlRpcPeer(serverToClient, clientToServer);

    peer.onServerRequest(async (request) => ({ accepted: request.method === "approval" }));
    const outbound = readNextJson(clientToServer);
    serverToClient.write(`${JSON.stringify({ id: 7, method: "approval", params: {} })}\n`);

    await expect(outbound).resolves.toEqual({ id: 7, result: { accepted: true } });
    peer.dispose();
  });
});

