import type { JsonRpcErrorData } from "./types";

export class AppServerRpcError extends Error {
  readonly code: number;
  readonly data: JsonRpcErrorData["data"];

  constructor(error: JsonRpcErrorData) {
    super(error.message);
    this.name = "AppServerRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class AppServerConnectionClosedError extends Error {
  constructor(message = "The codex app-server connection is closed.") {
    super(message);
    this.name = "AppServerConnectionClosedError";
  }
}

