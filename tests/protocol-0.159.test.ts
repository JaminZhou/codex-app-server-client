import { describe, expect, it } from "vitest";
import { AppServerProtocolValidationError } from "../src";
import type { v2 } from "../src/generated/protocol";
import { loadProtocolValidator } from "../src/protocol-validator";

const itemAnchor: v2.ThreadItemsListCursor = { type: "item", itemId: "item-1" };
const tooManyDenials: v2.CodexErrorInfo = "tooManyDenials";

describe("Codex 0.159 public protocol upgrade", () => {
  it("validates MCP server filtering and both item-history cursor forms", async () => {
    const validator = await loadProtocolValidator();
    expect(() => validator.assertClientRequest("mcpServerStatus/list", { serverName: "local-tools" }))
      .not.toThrow();
    expect(() => validator.assertClientRequest("mcpServerStatus/list", { serverName: 7 }))
      .toThrow(AppServerProtocolValidationError);

    for (const cursor of ["opaque-next-page", itemAnchor]) {
      expect(() => validator.assertClientRequest("thread/items/list", {
        threadId: "thread-1",
        turnId: "turn-1",
        cursor,
      })).not.toThrow();
    }
    expect(() => validator.assertClientRequest("thread/items/list", {
      threadId: "thread-1",
      turnId: "turn-1",
      cursor: { type: "unknown", itemId: "item-1" },
    })).toThrow(AppServerProtocolValidationError);
  });

  it("accepts the new too-many-denials error variant", async () => {
    const validator = await loadProtocolValidator();
    expect(() => validator.assertServerNotification({
      method: "error",
      params: {
        error: {
          message: "Access was denied too many times.",
          codexErrorInfo: tooManyDenials,
          additionalDetails: null,
        },
        willRetry: false,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })).not.toThrow();
  });
});
