import { describe, expect, it } from "vitest";
import type { CodexAppServerClient } from "../src/app-server-client";
import { CodexTurn, CodexTurnFailedError, normalizeTurnInput } from "../src";
import type { ThreadTokenUsage } from "../src/generated/protocol/v2/ThreadTokenUsage";
import type { Turn } from "../src/generated/protocol/v2/Turn";
import { TurnEventRouter } from "../src/turn-event-router";

const usage: ThreadTokenUsage = {
  total: {
    totalTokens: 10,
    inputTokens: 4,
    cachedInputTokens: 1,
    outputTokens: 6,
    reasoningOutputTokens: 2,
  },
  last: {
    totalTokens: 10,
    inputTokens: 4,
    cachedInputTokens: 1,
    outputTokens: 6,
    reasoningOutputTokens: 2,
  },
  modelContextWindow: 128_000,
};

describe("turn event routing and handles", () => {
  it("buffers events that arrive before a turn handle is opened", async () => {
    const router = new TurnEventRouter();
    router.route({
      emittedAtMs: 100,
      method: "turn/started",
      params: { threadId: "thread-1", turn: turn("turn-1", "inProgress") },
    });
    router.route({
      emittedAtMs: 200,
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });

    const methods: string[] = [];
    const timestamps: Array<number | undefined> = [];
    for await (const event of router.open("turn-1")) {
      methods.push(event.method);
      timestamps.push(event.emittedAtMs);
    }
    expect(methods).toEqual(["turn/started", "turn/completed"]);
    expect(timestamps).toEqual([100, 200]);
  });

  it("collects completed items, usage, and the final answer", async () => {
    const router = new TurnEventRouter();
    const handle = new CodexTurn(
      {} as CodexAppServerClient,
      "thread-1",
      "turn-1",
      router.open("turn-1"),
    );

    router.route({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1,
        item: {
          type: "agentMessage",
          id: "item-1",
          text: "working",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    });
    router.route({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 2,
        item: {
          type: "agentMessage",
          id: "item-2",
          text: "done",
          phase: "final_answer",
          memoryCitation: null,
        },
      },
    });
    router.route({
      method: "thread/tokenUsage/updated",
      params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: usage },
    });
    router.route({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });

    await expect(handle.result()).resolves.toMatchObject({
      finalResponse: "done",
      usage,
      turn: { id: "turn-1", status: "completed" },
    });
  });

  it("raises a typed error for failed turns", async () => {
    const router = new TurnEventRouter();
    const handle = new CodexTurn(
      {} as CodexAppServerClient,
      "thread-1",
      "turn-1",
      router.open("turn-1"),
    );
    const failed = turn("turn-1", "failed");
    failed.error = { message: "model failed", codexErrorInfo: null, additionalDetails: null };
    router.route({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: failed },
    });
    await expect(handle.result()).rejects.toBeInstanceOf(CodexTurnFailedError);
  });

  it("normalizes string input to the generated wire type", () => {
    expect(normalizeTurnInput("hello")).toEqual([
      { type: "text", text: "hello", text_elements: [] },
    ]);
  });
});

function turn(id: string, status: Turn["status"]): Turn {
  return {
    id,
    status,
    items: [],
    itemsView: "full",
    error: null,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : 1_000,
  };
}
