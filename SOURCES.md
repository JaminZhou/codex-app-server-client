# Sources and provenance

This repository is an independently written client for public Codex interfaces.

## Normative public sources

- [Official Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [Codex app-server protocol documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Open-source app-server implementation](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- [Open-source app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol)
- [Official OpenAI Codex Python SDK](https://github.com/openai/codex/tree/main/sdk/python)
- [OpenAI Codex repository](https://github.com/openai/codex)

## Pinned protocol provenance

- CLI package: `@openai/codex@0.145.0`
- Open-source tag: `rust-v0.145.0`
- Open-source commit: `25af12f7e61572b0bc18ddb1008be543b91519b0`
- Method-map source: `codex-rs/app-server-protocol/src/protocol/common.rs`

The CLI generates `src/generated/protocol/` and `schemas/`. A deterministic post-generation
normalization changes Rust 64-bit integer TypeScript fields from `bigint` to `number | bigint`,
matching the lossless JSONL runtime representation. The public Rust `client_request_definitions!`
and `server_request_definitions!` tables supply method-to-response associations recorded in
`protocol-methods.json`. Generation verifies that these tables exactly match the CLI-generated
request unions and that every response type exists.

Runtime validation compiles the pinned aggregate Schema plus generated standalone server-response
Schema. Unknown method names remain forward-compatible. The generator records the three deprecated
client responses for which the upstream CLI exports TypeScript but no JSON Schema, so that boundary
cannot silently regress into a claim of complete runtime coverage.

The generated protocol bindings and Schema retain their OpenAI Codex attribution and Apache-2.0
licensing through `THIRD_PARTY_NOTICES.md` and the bundled license copy under
`THIRD_PARTY_LICENSES/`. The independent client implementation remains MIT-licensed.

The Python SDK is used as a behavioral reference for transport closure, request routing, early
notification buffering, interactive login handles, initialization, typed error mapping, overload
retry, per-thread start coordination, thread/turn handles, logical thread-goal routing, and result
collection. Its public local Responses-provider test pattern is also a normative reference for
no-usage end-to-end testing. The TypeScript implementation and Node test fixture are written
independently for Node streams, promises, and HTTP.

## Explicit exclusions

The private Codex Desktop `AppServerConnection` implementation, code extracted from the Desktop `app.asar` bundle, private symbols, and private service behavior are not included in or used as implementation source for this repository.

Behavioral parity means parity within the public `codex app-server` protocol surface, not reproduction of private Desktop implementation details.
