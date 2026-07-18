# Codex App Server Client

An independently implemented TypeScript client for the public `codex app-server` JSON-RPC protocol.

> This is an unofficial open-source project. It is not affiliated with, sponsored by, or endorsed by OpenAI. Codex and OpenAI are trademarks of OpenAI.

## Why this exists

The official TypeScript Codex SDK runs `codex exec`. This project targets the richer, long-lived `codex app-server` surface used to build interactive clients: concurrent requests, server-initiated approvals, typed notifications, thread lifecycle, turn streaming, and race-safe process management.

The implementation uses only public sources:

- generated TypeScript bindings and JSON Schema from the public Codex CLI;
- the public app-server protocol and implementation;
- the official open-source Python SDK as a behavioral reference.

No Codex Desktop private code or extracted `app.asar` code is included or used as implementation source.

## Status

Pre-1.0 public development. The main protocol and client architecture are implemented, but the
package API may still change before the first npm release.

Current pinned runtime and protocol baseline: `@openai/codex@0.144.5`
(`codex-cli 0.144.5` / `rust-v0.144.5`), including its generated experimental surface. See
[SOURCES.md](./SOURCES.md) for exact provenance.

## Highlights

- Resolves the version-matched CLI installed with this package; no global `codex` installation is required.
- Starts a version-matched stdio app-server, or attaches through the public Unix socket and
  experimental TCP WebSocket transports.
- Provides a fully typed `call()` API for all 125 client methods in the pinned protocol.
- Exposes generated protocol types through `codex-app-server-client/protocol`.
- Routes typed notifications and all generated server-request methods.
- Buffers turn events that arrive before the `turn/start` response is consumed.
- Provides high-level `CodexThread` and `CodexTurn` handles with async event streaming.
- Exercises collected and manually streamed turns through a real app-server against an isolated
  local Responses provider, so the end-to-end test cannot consume model usage.
- Exercises a real app-server command-approval callback and verifies that a declined command is
  represented as declined without being executed.
- Provides browser and device-code login handles with race-safe completion routing.
- Exposes persisted thread-goal CRUD and coalesces automatic goal continuations into one logical
  turn stream.
- Serializes high-level turn and goal starts per thread while preserving concurrency across threads.
- Maps JSON-RPC errors into typed errors and includes bounded overload retry support.
- Preserves the public W3C trace context and classifies documented `-32001` ingress overloads.
- Preserves 64-bit JSON integer precision, using `number` when safe and `bigint` otherwise.
- Validates known public-protocol traffic at runtime against the pinned generated JSON Schema.
- Handles request cancellation, timeouts, ordered writes, bounded stderr capture, and process shutdown.
- Verifies generated TypeScript, JSON Schema, and request/response maps in CI.
- Runs a real app-server compatibility smoke across the pinned and immediately previous stable
  Codex releases.

## Installation

The package is not yet published to npm. Once published:

```bash
pnpm add codex-app-server-client
```

`@openai/codex` is an exact runtime dependency. The client resolves that local package and its platform-specific optional dependency. Pass `codexPath` only when intentionally testing another binary.

## Quick start

```ts
import { CodexAppServerClient } from "codex-app-server-client";

const client = new CodexAppServerClient({
  requestTimeoutMs: 30_000,
});

// Approval behavior is explicit. This example declines command execution.
client.onServerRequest("item/commandExecution/requestApproval", () => ({
  decision: "decline",
}));

await client.connect();

try {
  const thread = await client.createThread({ cwd: process.cwd() });
  const result = await thread.run("Summarize this repository.");
  console.log(result.finalResponse);
} finally {
  await client.close();
}
```

Running a turn can use the authenticated Codex account associated with the selected `CODEX_HOME` and may consume usage.
The integration suite instead uses a temporary `CODEX_HOME` whose provider points only to a
loopback mock Responses endpoint.

## Transports

The default is a managed local stdio child process:

```ts
const client = new CodexAppServerClient();
```

To attach to an app-server already listening on its local control socket:

```ts
const client = new CodexAppServerClient({
  transport: { type: "unix" },
});
```

The default socket is
`$CODEX_HOME/app-server-control/app-server-control.sock` (or the equivalent under `~/.codex`).
Pass an absolute `socketPath` to connect elsewhere. Unix mode performs the standard WebSocket HTTP
Upgrade over that socket; it does not spawn or own the app-server process.

TCP WebSocket is exposed because it is part of the public CLI, but upstream labels it experimental
and unsupported. Do not treat it as a production-supported upstream transport:

```ts
const client = new CodexAppServerClient({
  transport: {
    type: "websocket",
    url: "wss://codex-host.example/ws",
    bearerTokenEnv: "CODEX_APP_SERVER_TOKEN",
  },
});
```

The transport omits `Origin`, disables redirects and compression, bounds handshake time and inbound
payload size, and rejects plaintext `ws://` to non-loopback hosts unless
`allowInsecureRemote: true` is explicitly set. Local-process launch options are rejected when an
attach transport is selected so they cannot be silently ignored.

## Complete typed protocol access

`call()` derives its parameter type from generated `ClientRequest` bindings and its result type from the matching public Rust protocol response type:

```ts
const page = await client.call("thread/list", {
  limit: 20,
  sortDirection: "desc",
});

for (const thread of page.data) {
  console.log(thread.id);
}

// Methods whose protocol params are undefined require no second argument.
await client.call("account/logout");
```

For forward compatibility or deliberately untyped extensions, `request<T>(method, params)` remains available as a raw escape hatch.

## Runtime protocol validation

Generated Schema validation is enabled by default. Before writing, known client requests and
notifications are checked against the pinned protocol. Incoming known responses, notifications,
server requests, and typed server-request handler results are checked before they enter high-level
routing. A malformed known response or notification closes the mismatched connection instead of
letting invalid data contaminate client state.

Unknown method names remain available to generic handlers and raw `request()` calls without being
rejected, preserving a deliberate forward-compatibility path. Disable validation only for explicit
version-skew experiments:

```ts
const client = new CodexAppServerClient({
  protocolValidation: "off",
});
```

Validation preserves `bigint` values in its private comparison copy and enforces the public Rust
integer formats (`int32`, `int64`, `uint`, `uint16`, `uint32`, and `uint64`) without lossy number
conversion. Integer-valued `double` fields remain doubles across the full finite JavaScript range.
The value sent to or received from app-server remains lossless. The upstream generator does not
currently export response Schema for three deprecated compatibility methods: `getAuthStatus`,
`getConversationSummary`, and `gitDiffToRemote`. Their request parameters remain validated and
their responses remain statically typed, but their response payloads are the explicit runtime
validation exceptions reported by `protocolValidationMetadata`.

## Account and login workflows

Account methods operate on the `CODEX_HOME` used by the connected app-server. API-key login is a
single request; interactive ChatGPT login returns a live handle whose completion notification is
buffered even if it arrives before the start response:

```ts
const login = await client.loginChatGPTDeviceCode();
console.log(login.verificationUrl, login.userCode);

const completed = await login.wait({ timeoutMs: 5 * 60_000 });
if (!completed.success) throw new Error(completed.error ?? "Login failed");

const account = await client.account(true);
console.log(account.account);
```

Use `login.cancel()` to cancel that specific attempt. `loginChatGPT()` exposes the equivalent
browser flow through `authUrl`; `loginApiKey()` and `loginChatGPTAuthTokens()` cover the other
generated public login variants. Do not log API keys, access tokens, or raw auth-token parameters.

## Thread, turn, and goal handles

```ts
const thread = await client.resumeThread(savedThreadId);
const turn = await thread.startTurn("Continue from the previous result.");

for await (const notification of turn.events()) {
  if (notification.method === "item/agentMessage/delta") {
    process.stdout.write(notification.params.delta);
  }
}
```

Each turn event stream has a single consumer. Use either `turn.events()` for manual streaming or `turn.result()` / `thread.run()` to collect the final response, completed items, final turn state, and token usage.

Persisted thread goals are also available at both the raw typed layer and through `CodexThread`:

```ts
const thread = await client.resumeThread(savedThreadId);
const goal = await thread.startGoal("Keep fixing failures until every quality gate passes", {
  tokenBudget: 200_000,
});

const result = await goal.result();
console.log(result.finalResponse);
```

`startGoal()` requires an idle, persisted thread. It replaces the stored goal, waits for the
runtime-generated first turn, and represents later automatic physical turns as a single logical
turn whose ID is the first physical turn ID. Intermediate `turn/started` and `turn/completed`
notifications are suppressed from that logical stream, while ordinary notification handlers still
receive the original physical events. Terminal goal states (`paused`, `blocked`, `usageLimited`,
`budgetLimited`, and `complete`) end the logical stream after the active physical turn finishes.
Call `goal.pause()` to update the stored goal and interrupt the current physical turn on a
best-effort basis.

## Typed notifications and server requests

Handlers can be registered before or after `connect()`:

```ts
client.onNotification("turn/completed", ({ threadId, turn }) => {
  console.log(threadId, turn.status);
});

client.onServerRequest("item/fileChange/requestApproval", async (params) => {
  console.log(params.itemId, params.reason);
  return { decision: "decline" };
});

client.onError((error) => {
  console.error("handler error", error);
});
```

Unhandled server requests receive JSON-RPC method-not-found. The client does not auto-approve commands or file changes.

## Cancellation, timeouts, and retry

```ts
import { retryOnAppServerOverload } from "codex-app-server-client";

const controller = new AbortController();

const thread = await retryOnAppServerOverload(
  () =>
    client.call(
      "thread/read",
      { threadId: savedThreadId, includeTurns: true },
      { signal: controller.signal, timeoutMs: 10_000 },
    ),
  { maxAttempts: 3 },
);
```

Only overload-classified JSON-RPC failures are retried. Invalid requests, invalid params, authentication failures, and application errors are not retried automatically.

W3C trace context can be attached to any request:

```ts
await client.call(
  "thread/read",
  { threadId: savedThreadId },
  {
    trace: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  },
);
```

## Protocol exports

```ts
import type {
  ServerNotification,
  v2,
} from "codex-app-server-client/protocol";

import { protocolMetadata } from "codex-app-server-client/protocol";
```

JSON Schema artifacts are included under `schemas/` in the package.

The generated Rust 64-bit integer fields are normalized to `number | bigint` to match the JSONL
transport: safe integer literals remain numbers, while larger integer literals are parsed and
serialized losslessly as bigints. Pass integer values outside the safe `number` range as `bigint`
before JavaScript rounds them; once a value is a `number`, the transport cannot distinguish an
already-rounded integer from a valid integer-valued double such as `1e16`. Non-finite numbers are
rejected instead of being silently converted to `null`, and custom numeric request IDs follow the
upstream signed 64-bit integer contract; fractional or out-of-range IDs are rejected before they can
break response correlation. JSON-RPC error codes follow the same signed 64-bit normalization, so
large valid codes remain `bigint` instead of being rejected or rounded. Finite double-valued protocol
fields remain supported across their full JavaScript range.

The generated surface includes experimental methods and fields so rich clients can opt in through `InitializeCapabilities.experimentalApi`. Experimental APIs can change between Codex CLI releases; pin the client version and run compatibility tests before upgrading.

See [COMPATIBILITY.md](./COMPATIBILITY.md) for the verified transport and protocol matrix, plus the
remaining high-level parity work.

## CLI resolution

By default the client resolves this dependency chain:

```text
codex-app-server-client
└── @openai/codex (exact version)
    └── platform-specific Codex binary
```

It does not search the global `PATH`. To override this intentionally:

```ts
const client = new CodexAppServerClient({
  codexPath: "/absolute/path/to/codex",
});
```

## Development

```bash
pnpm install
pnpm protocol:check
pnpm check
```

Regenerate version-matched protocol artifacts:

```bash
pnpm protocol:generate
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the CLI upgrade and public-source extraction workflow.

## License

The independently written client is MIT-licensed. Generated Codex protocol bindings and Schema are
distributed with their OpenAI attribution under Apache-2.0; see
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
