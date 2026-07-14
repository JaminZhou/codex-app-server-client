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

- CLI package: `@openai/codex@0.144.4`
- Open-source tag: `rust-v0.144.4`
- Open-source commit: `8c68d4c87dc54d38861f5114e920c3de2efa5876`
- Method-map source: `codex-rs/app-server-protocol/src/protocol/common.rs`

The CLI generates `src/generated/protocol/` and `schemas/`. A deterministic post-generation normalization changes Rust 64-bit integer TypeScript fields from `bigint` to `number | bigint`, matching the lossless JSONL runtime representation. The public Rust `client_request_definitions!` table supplies method-to-response associations recorded in `protocol-methods.json`. Generation verifies that this table exactly matches the CLI-generated `ClientRequest` method union and that every response type exists.

The Python SDK is used as a behavioral reference for transport closure, request routing, early notification buffering, initialization, typed error mapping, overload retry, thread/turn handles, and result collection. The TypeScript implementation is written independently for Node streams and promises.

## Explicit exclusions

The private Codex Desktop `AppServerConnection` implementation, code extracted from the Desktop `app.asar` bundle, private symbols, and private service behavior are not included in or used as implementation source for this repository.

Behavioral parity means parity within the public `codex app-server` protocol surface, not reproduction of private Desktop implementation details.
