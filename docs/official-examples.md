# Official example alignment

The baseline is the 15 groups in the public [Python app-server SDK examples at Codex 0.153.4](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/sdk/python/examples),
the exact source commit for this client's pinned runtime. These are independently written Node.js
equivalents of those workflows, not a Python API port or a separate consumer application.

This batch is **unreleased source / local-candidate content**. The immutable npm `0.1.0` archive
contains the three earlier safety examples, not these 15 numbered files. Use this checkout or a
verified candidate built from it; do not expect a reinstall of `0.1.0` to add them.

## Mapping and observable checks

Official directory names match the numbered Node filenames below. Python's `async.py` is the
reference except group 09, which has only `sync.py`. Node uses promises/async iterators throughout;
adding a blocking Python-style API is not required to demonstrate the same workflow.

| Official group / Node entry point | Demonstrated workflow and default check |
| --- | --- |
| [01_quickstart_constructor](../examples/01_quickstart_constructor.mjs) | Connect, initialization metadata, create thread, collect text/items/status |
| [02_turn_run](../examples/02_turn_run.mjs) | Explicit turn handle, matching IDs, collected result and usage snapshots |
| [03_turn_stream_events](../examples/03_turn_stream_events.mjs) | Started/delta/completed events, terminal status, completed-item text fallback |
| [04_models_and_metadata](../examples/04_models_and_metadata.mjs) | Server/platform metadata and paginated model listing |
| [05_existing_thread](../examples/05_existing_thread.mjs) | Resume the same persisted thread; next provider request retains prior input |
| [06_thread_lifecycle_and_controls](../examples/06_thread_lifecycle_and_controls.mjs) | Read/list/name/archive/unarchive/resume/fork/compact; assert IDs, history and completion |
| [07_image_and_text](../examples/07_image_and_text.mjs) | Generated PNG as a data URL plus text; provider receives an encoded image |
| [08_local_image_and_text](../examples/08_local_image_and_text.mjs) | Temporary PNG as local-image input; provider receives it and local file is cleaned up |
| [09_async_parity](../examples/09_async_parity.mjs) | Thread/turn/result workflow through Node's native async API, no duplicate sync API |
| [10_error_handling_and_retry](../examples/10_error_handling_and_retry.mjs) | Typed overload/RPC errors and bounded retry of a rejected start acknowledgement |
| [11_cli_mini_app](../examples/11_cli_mini_app.mjs) | A single-thread terminal loop, streamed replies/usage, blank lines, `/exit`, `/quit`, EOF |
| [12_turn_params_kitchen_sink](../examples/12_turn_params_kitchen_sink.mjs) | Structured output, personality and reasoning summary; validate JSON shape and outbound schema |
| [13_model_select_and_turn_params](../examples/13_model_select_and_turn_params.mjs) | Filter hidden/upgraded models, select advertised effort, run plain/structured turns with options |
| [14_turn_controls](../examples/14_turn_controls.mjs) | Steer an active held stream, then interrupt a separate turn and drain terminal events |
| [15_login_and_account](../examples/15_login_and_account.mjs) | Start/cancel/wait/read account through the real client and a scripted RPC server |

## Deliberate boundaries

- Groups 01–14 and the existing `stream`, `approvals`, `interrupt-resume` examples use the real
  bundled app-server with isolated temporary homes and a local scripted Responses provider.
  Successful model output is a fixture: this does not establish model quality, vision accuracy,
  account entitlement, or availability of a model on a real account.
- Group 15 defaults to a **scripted WebSocket RPC server**, not a real app-server or OAuth service.
  It exercises strict protocol validation, the public login handle and early completion buffering
  without reading credentials or starting authentication. Its `--live` mode starts and immediately
  cancels real OAuth in a separate temporary home; it does not open a browser or sign in, and is
  excluded from all automatic tests. Cancellation is not evidence of successful authentication.
- Group 10 injects one typed overload **before** submitting its mock turn. Only explicitly rejected
  start requests are retried, up to three attempts; result collection is outside the retry block.
  It does not retry unknown-outcome timeouts, accepted turns, auth failures or arbitrary errors.
- Group 13 mirrors the official lexical/advertised-upgrade heuristic, not a model-quality or cost
  ranking. It selects the highest advertised reasoning effort; the runtime may normalize that value
  for its provider wire protocol. `--live` can therefore be expensive. No hard-coded model entitlement
  or model-name ordering beyond the official example's heuristic is promised.
- `compact()` acknowledges scheduling. Group 06 additionally waits for `item/completed` with
  `contextCompaction`; it does not mistake the acknowledgement or the legacy `thread/compacted`
  notification name for completion on this runtime.
- With a live provider, a turn may finish before steering/interruption arrives. Group 14 exposes
  that race; default held-stream fixtures require steering to apply and interruption to complete.
  Approval handlers remain explicit declines, not unconditional permission grants.

The upstream main snapshot inspected on 2026-09-10 additionally contains
[16_external_message](https://github.com/openai/codex/tree/a62e98d18c6550e3bea152ed1b89d1e931dca961/sdk/python/examples/16_external_message).
It is **outside this pinned baseline**: `ExternalMessage` is not in the generated `0.153.4` input
union. Supporting it needs a separately reviewed runtime/protocol upgrade. Passing external data
as ordinary user text would not establish equivalent semantics, so this batch does not do that.

## Run and verify

From a built source checkout:

```bash
node examples/01_quickstart_constructor.mjs
node examples/11_cli_mini_app.mjs --interactive
node examples/15_login_and_account.mjs
pnpm examples:smoke
pnpm package:smoke
node scripts/package-smoke.mjs --pnpm
```

The suite runs all 18 files plus four piped CLI cases (exit, quit, EOF and empty input).
Installed-package verification copies the **shipped** examples into fresh npm/pnpm consumers and
checks their catalog, ESM/schema imports, strict declarations and runtime binary. Platform CI runs
the npm package suite on Linux/macOS/Windows, with an additional pnpm consumer on Linux.

No automatic check uses `--live`; the aggregate `pnpm examples:smoke` explicitly rejects all arguments.
Only individual example commands accept `--live`. In groups 01–14, it uses the selected existing Codex home and
working directory; lifecycle examples create/persist their own threads and the mini CLI can keep
running until you exit. Non-interactive mock runs have a 45-second per-example deadline; interactive
input and live turns have no imposed total deadline. The smoke runner bounds every child process,
including piped interactive cases, to 60 seconds. Review the example before opting in. See [commands and recovery](../examples/README.md)
for setup and the authentication/cleanup boundaries.
