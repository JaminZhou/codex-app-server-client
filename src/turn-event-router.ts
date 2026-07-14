import type { ServerNotification } from "./generated/protocol/ServerNotification";
import type { JsonRpcNotification } from "./types";

const MAX_PENDING_TURNS = 128;
const MAX_PENDING_EVENTS_PER_TURN = 2_000;

export class TurnEventStream implements AsyncIterableIterator<ServerNotification> {
  private readonly onDispose: () => void;
  private readonly values: ServerNotification[] = [];
  private readonly waiters: Array<{
    reject: (error: Error) => void;
    resolve: (result: IteratorResult<ServerNotification>) => void;
  }> = [];
  private done = false;
  private failure: Error | null = null;

  constructor(onDispose: () => void) {
    this.onDispose = onDispose;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ServerNotification> {
    return this;
  }

  next(): Promise<IteratorResult<ServerNotification>> {
    if (this.failure) return Promise.reject(this.failure);
    const value = this.values.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiters.push({ reject, resolve }));
  }

  return(): Promise<IteratorResult<ServerNotification>> {
    this.complete();
    this.values.length = 0;
    return Promise.resolve({ done: true, value: undefined });
  }

  push(value: ServerNotification): void {
    if (this.done || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  complete(): void {
    if (this.done || this.failure) return;
    this.done = true;
    this.onDispose();
    if (this.values.length === 0) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.resolve({ done: true, value: undefined });
      }
    }
  }

  fail(error: Error): void {
    if (this.done || this.failure) return;
    this.failure = error;
    this.values.length = 0;
    this.onDispose();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

export class TurnEventRouter {
  private readonly active = new Map<string, TurnEventStream>();
  private readonly pending = new Map<string, ServerNotification[]>();

  open(turnId: string): TurnEventStream {
    if (this.active.has(turnId)) {
      throw new Error(`Turn ${turnId} already has an active event stream.`);
    }
    const stream = new TurnEventStream(() => {
      if (this.active.get(turnId) === stream) this.active.delete(turnId);
    });
    this.active.set(turnId, stream);

    for (const notification of this.pending.get(turnId) ?? []) {
      stream.push(notification);
      if (isCompletion(notification, turnId)) stream.complete();
    }
    this.pending.delete(turnId);
    return stream;
  }

  route(notification: JsonRpcNotification): void {
    const turnId = notificationTurnId(notification);
    if (!turnId) return;
    const typed = notification as ServerNotification;
    const stream = this.active.get(turnId);
    if (stream) {
      stream.push(typed);
      if (isCompletion(typed, turnId)) stream.complete();
      return;
    }

    if (!this.pending.has(turnId) && this.pending.size >= MAX_PENDING_TURNS) {
      const oldest = this.pending.keys().next().value;
      if (oldest) this.pending.delete(oldest);
    }
    const events = this.pending.get(turnId) ?? [];
    events.push(typed);
    if (events.length > MAX_PENDING_EVENTS_PER_TURN) events.shift();
    this.pending.set(turnId, events);
  }

  failAll(error: Error): void {
    for (const stream of this.active.values()) stream.fail(error);
    this.active.clear();
    this.pending.clear();
  }

  clear(): void {
    for (const stream of this.active.values()) stream.complete();
    this.active.clear();
    this.pending.clear();
  }
}

function notificationTurnId(notification: JsonRpcNotification): string | null {
  const params = notification.params;
  if (!isRecord(params)) return null;
  if (typeof params.turnId === "string") return params.turnId;
  if (isRecord(params.turn) && typeof params.turn.id === "string") return params.turn.id;
  return null;
}

function isCompletion(notification: ServerNotification, turnId: string): boolean {
  return (
    notification.method === "turn/completed" && notification.params.turn.id === turnId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
