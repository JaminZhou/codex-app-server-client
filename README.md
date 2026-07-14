# Codex App Server Client

A TypeScript client for the public `codex app-server` JSON-RPC protocol.

> This is an unofficial, independently developed open-source project for the public Codex ecosystem. It is not affiliated with, sponsored by, or endorsed by OpenAI. Codex and OpenAI are trademarks of OpenAI.

## Status

Early private development. The public API is not stable yet.

## Current scope

- Start a local `codex app-server` process over stdio.
- Perform the `initialize` / `initialized` handshake.
- Send JSON-RPC requests and notifications.
- Receive notifications and server-initiated requests.
- Keep the transport independent from generated protocol types.

## Example

```ts
import { CodexAppServerClient } from "codex-app-server-client";

const client = new CodexAppServerClient({
  clientInfo: {
    name: "my_coding_agent",
    title: "My Coding Agent",
    version: "0.1.0",
  },
});

await client.connect();

const thread = await client.request("thread/start", {
  cwd: process.cwd(),
});

console.log(thread);
await client.close();
```

Generate version-matched TypeScript protocol types with the target Codex binary:

```bash
codex app-server generate-ts --out src/generated/app-server
```

## Development

```bash
pnpm install
pnpm check
```

## License

MIT

