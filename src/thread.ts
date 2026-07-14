import type { CodexAppServerClient } from "./app-server-client";
import { CodexTurnFailedError } from "./errors";
import type { ServerNotification } from "./generated/protocol/ServerNotification";
import type { Thread } from "./generated/protocol/v2/Thread";
import type { ThreadCompactStartResponse } from "./generated/protocol/v2/ThreadCompactStartResponse";
import type { ThreadItem } from "./generated/protocol/v2/ThreadItem";
import type { ThreadReadResponse } from "./generated/protocol/v2/ThreadReadResponse";
import type { ThreadSetNameResponse } from "./generated/protocol/v2/ThreadSetNameResponse";
import type { ThreadTokenUsage } from "./generated/protocol/v2/ThreadTokenUsage";
import type { Turn } from "./generated/protocol/v2/Turn";
import type { TurnInterruptResponse } from "./generated/protocol/v2/TurnInterruptResponse";
import type { TurnStartParams } from "./generated/protocol/v2/TurnStartParams";
import type { TurnSteerParams } from "./generated/protocol/v2/TurnSteerParams";
import type { TurnSteerResponse } from "./generated/protocol/v2/TurnSteerResponse";
import type { UserInput } from "./generated/protocol/v2/UserInput";
import type { RequestOptions } from "./types";
import type { TurnEventStream } from "./turn-event-router";

export type CodexTurnInput = string | UserInput | readonly UserInput[];
export type CodexTurnStartOptions = Omit<TurnStartParams, "input" | "threadId">;
export type CodexTurnSteerOptions = Omit<
  TurnSteerParams,
  "expectedTurnId" | "input" | "threadId"
>;

export interface CodexTurnResult {
  finalResponse: string | null;
  items: ThreadItem[];
  turn: Turn;
  usage: ThreadTokenUsage | null;
}

export class CodexThread {
  readonly id: string;
  readonly snapshot: Thread;
  private readonly client: CodexAppServerClient;

  constructor(client: CodexAppServerClient, snapshot: Thread) {
    this.client = client;
    this.snapshot = snapshot;
    this.id = snapshot.id;
  }

  startTurn(
    input: CodexTurnInput,
    options: CodexTurnStartOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<CodexTurn> {
    return this.client.startTurn(this.id, input, options, requestOptions);
  }

  async run(
    input: CodexTurnInput,
    options: CodexTurnStartOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<CodexTurnResult> {
    return (await this.startTurn(input, options, requestOptions)).result();
  }

  read(includeTurns = false, requestOptions: RequestOptions = {}): Promise<ThreadReadResponse> {
    return this.client.threadRead({ threadId: this.id, includeTurns }, requestOptions);
  }

  setName(name: string, requestOptions: RequestOptions = {}): Promise<ThreadSetNameResponse> {
    return this.client.threadSetName({ threadId: this.id, name }, requestOptions);
  }

  compact(requestOptions: RequestOptions = {}): Promise<ThreadCompactStartResponse> {
    return this.client.threadCompact({ threadId: this.id }, requestOptions);
  }
}

export class CodexTurn {
  readonly id: string;
  readonly threadId: string;
  private readonly client: CodexAppServerClient;
  private readonly stream: TurnEventStream;
  private consumed = false;

  constructor(
    client: CodexAppServerClient,
    threadId: string,
    turnId: string,
    stream: TurnEventStream,
  ) {
    this.client = client;
    this.threadId = threadId;
    this.id = turnId;
    this.stream = stream;
  }

  events(): AsyncIterableIterator<ServerNotification> {
    if (this.consumed) throw new Error(`Turn ${this.id} event stream can only be consumed once.`);
    this.consumed = true;
    return this.stream;
  }

  steer(
    input: CodexTurnInput,
    options: CodexTurnSteerOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<TurnSteerResponse> {
    return this.client.turnSteer(
      {
        ...options,
        threadId: this.threadId,
        expectedTurnId: this.id,
        input: normalizeTurnInput(input),
      },
      requestOptions,
    );
  }

  interrupt(requestOptions: RequestOptions = {}): Promise<TurnInterruptResponse> {
    return this.client.turnInterrupt(
      { threadId: this.threadId, turnId: this.id },
      requestOptions,
    );
  }

  async result(): Promise<CodexTurnResult> {
    const items: ThreadItem[] = [];
    let usage: ThreadTokenUsage | null = null;
    let completed: Turn | null = null;

    for await (const event of this.events()) {
      if (event.method === "item/completed" && event.params.turnId === this.id) {
        items.push(event.params.item);
      } else if (
        event.method === "thread/tokenUsage/updated" &&
        event.params.turnId === this.id
      ) {
        usage = event.params.tokenUsage;
      } else if (event.method === "turn/completed" && event.params.turn.id === this.id) {
        completed = event.params.turn;
      }
    }

    if (!completed) throw new Error(`Turn ${this.id} completed without a completion event.`);
    if (completed.status === "failed") throw new CodexTurnFailedError(completed);
    return {
      finalResponse: finalAssistantResponse(items),
      items,
      turn: completed,
      usage,
    };
  }
}

export function normalizeTurnInput(input: CodexTurnInput): UserInput[] {
  if (typeof input === "string") {
    return [{ type: "text", text: input, text_elements: [] }];
  }
  return Array.isArray(input) ? [...input] : [input as UserInput];
}

function finalAssistantResponse(items: readonly ThreadItem[]): string | null {
  let phaseUnknown: string | null = null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== "agentMessage") continue;
    if (item.phase === "final_answer") return item.text;
    if (item.phase === null && phaseUnknown === null) phaseUnknown = item.text;
  }
  return phaseUnknown;
}
