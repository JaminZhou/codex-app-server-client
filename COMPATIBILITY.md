# Compatibility and parity

This document separates verified public-protocol coverage from higher-level convenience APIs that
are still being built. It is intentionally narrower than a claim of parity with any private Codex
Desktop implementation.

Upstream classifies [`codex app-server`](https://developers.openai.com/codex/app-server/) itself as
experimental and primarily intended for development or debugging. It may change without notice, so
every verification claim here is tied to exact versions rather than a general upstream stability
guarantee.

## Normative baseline

| Reference | Pinned baseline | How it is used |
| --- | --- | --- |
| Public Codex CLI | `codex-cli 0.144.6` / `rust-v0.144.6` | Runtime binary and public app-server behavior |
| Generated app-server TypeScript | Generated from the pinned CLI | Request, response, notification, and server-request types |
| Generated JSON Schema | Generated from the pinned CLI | Shipped schema artifacts and drift checks |
| Official Python SDK | Public source at the same Codex tag | Lifecycle, routing, error, and high-level behavior reference |

No private Codex Desktop code is a normative source or part of this package.

## Transport coverage

| Transport | Client support | Verification | Upstream status |
| --- | --- | --- | --- |
| stdio JSONL | Complete | Real pinned CLI integration test | Supported and default |
| Unix control socket | Complete for attaching to an existing server | Real pinned CLI integration test using the WebSocket Upgrade over a Unix socket | Intended for local control-plane clients |
| TCP WebSocket | Implemented with bounded resources and transport safety checks | Fake-server protocol tests and real pinned CLI integration test | Experimental and unsupported upstream |
| off | Not applicable to a client | Not applicable | Disables the server transport |

TCP WebSocket support does not turn the upstream experimental listener into a production-supported
transport. For production local rich clients, prefer stdio or the Unix control socket.

## Public protocol coverage

| Capability | Status | Evidence or boundary |
| --- | --- | --- |
| Typed client requests | Complete at the raw `call()` layer | All 125 generated client methods are mapped to generated parameter and response types |
| Notifications | Complete routing surface | Generic and generated method-scoped handlers |
| Server requests | Complete routing surface | Generic and generated method-scoped handlers with typed responses |
| Initialization lifecycle | Complete | Exactly one `initialize`, followed by `initialized`, per connection |
| Concurrent requests | Complete | UUID request IDs and response correlation independent of arrival order |
| Ordered writes and notifications | Complete | Serialized outbound writes and transport-order notification dispatch |
| W3C trace context | Complete at the JSON-RPC envelope | Outbound and inbound `traceparent` / `tracestate` preservation |
| 64-bit JSON integers | Complete at the wire layer | Safe values use `number`; unsafe integer literals and error codes round-trip as `bigint`; lossy numeric request IDs/error codes and non-finite inputs are rejected |
| Cancellation and timeout | Complete at the client request layer | Abort signals and bounded request timeouts |
| Backpressure error classification | Complete for the documented ingress error | `-32001` `Server overloaded; retry later.` maps to `AppServerBusyError` |
| Overload retry helper | Complete and opt-in | Exponential backoff with jitter; only overload-classified failures retry |
| Experimental protocol | Generated and available | Enabled by the default initialize capability; it remains version-sensitive |
| Runtime protocol validation | Complete for every generated request/notification/server-request shape and 122 of 125 client responses | Strict by default, including Rust signed/unsigned integer widths; three deprecated response types have no upstream JSON Schema |

Unknown method names bypass known-method Schema validation and remain available through generic
handlers and raw requests. This is intentional forward compatibility, not a claim that an unknown
shape has been verified. `protocolValidation: "off"` is available for deliberate version-skew
experiments.

## Cross-version verification

The scheduled compatibility smoke covers every exact stable release in
`compatibility-matrix.json`, currently `0.144.5` and the pinned `0.144.6`. On the minimum supported
Node.js 18 runtime it installs each CLI in isolation, starts its real stdio app-server with plugins
disabled, uses strict current-Schema validation, and exercises initialization, model and thread
listing, thread creation/read, and thread-goal access without calling a model service. The matrix is an
explicit verified window, not a compatibility claim for arbitrary older or preview releases.

Regular CI also packs and installs this client on Linux, macOS, and Windows, then initializes the
platform-specific bundled Codex app-server on Node.js 18. This checks the three operating-system
artifact paths independently; it does not extend the compatibility window beyond the exact CLI
versions listed above.

## High-level API coverage

| Area | Current high-level coverage | Raw typed fallback |
| --- | --- | --- |
| Threads | start, resume, fork, list, read, archive, unarchive, name, compact | Complete `call()` surface |
| Turns | start, steer, interrupt, event stream, collected result | Complete `call()` surface; collected and manually streamed turns are exercised through the real pinned app-server against a local mock Responses provider |
| Thread goals | get, set, clear, logical continuation stream, collected result, pause | Complete `call()` surface |
| Approvals and other server requests | Explicit typed handler registration; no implicit approval | Complete handler surface; a real pinned app-server command request is declined end to end and verified not to execute |
| Models | list | Complete `call()` surface |
| Account and login flows | API key, browser, device code, auth tokens, completion wait/cancel, account read, logout | Complete `call()` surface |
| MCP, apps, plugins, skills, config, review, processes, and remote control | No area-specific wrappers yet | Complete `call()` surface |

High-level `turn/start` and logical goal starts are serialized per thread, matching the official
Python SDK's protection against competing starts. Different threads remain concurrent. Goal
continuations preserve original notifications for generic handlers while the goal handle receives a
normalized single-turn stream.

The real-turn integration test uses an isolated temporary `CODEX_HOME`, disables managed config,
sets retries to zero, and routes the model provider exclusively to a loopback HTTP server. It
asserts the outbound Responses request as well as real `turn/started`, agent-message delta,
`item/completed`, token-usage, and `turn/completed` notifications without authenticating or
consuming model usage. A second real-runtime scenario sends a public `shell_command` model item,
handles the resulting typed `item/commandExecution/requestApproval` server request, declines it,
and verifies the command item is completed as `declined` without executing the command.

## Remaining parity work

The following items are deliberately not claimed as complete:

- response validation for the three deprecated compatibility methods whose response Schema is not
  exported upstream (`getAuthStatus`, `getConversationSummary`, and `gitDiffToRemote`);
- broader high-level operation-scope coordination outside turn and goal starts;
- automatic reconnect, replay, or idempotency policy for a dropped remote connection;
- production support for TCP WebSocket while upstream continues to label it experimental and
  unsupported.

These gaps do not reduce the generated raw protocol surface, but they matter before describing the
entire package as behaviorally complete for every rich-client workflow.
