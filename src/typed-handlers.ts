import type { ApplyPatchApprovalResponse } from "./generated/protocol/ApplyPatchApprovalResponse";
import type { ExecCommandApprovalResponse } from "./generated/protocol/ExecCommandApprovalResponse";
import type { ServerNotification } from "./generated/protocol/ServerNotification";
import type { ServerRequest } from "./generated/protocol/ServerRequest";
import type { AttestationGenerateResponse } from "./generated/protocol/v2/AttestationGenerateResponse";
import type { ChatgptAuthTokensRefreshResponse } from "./generated/protocol/v2/ChatgptAuthTokensRefreshResponse";
import type { CommandExecutionRequestApprovalResponse } from "./generated/protocol/v2/CommandExecutionRequestApprovalResponse";
import type { CurrentTimeReadResponse } from "./generated/protocol/v2/CurrentTimeReadResponse";
import type { DynamicToolCallResponse } from "./generated/protocol/v2/DynamicToolCallResponse";
import type { FileChangeRequestApprovalResponse } from "./generated/protocol/v2/FileChangeRequestApprovalResponse";
import type { McpServerElicitationRequestResponse } from "./generated/protocol/v2/McpServerElicitationRequestResponse";
import type { PermissionsRequestApprovalResponse } from "./generated/protocol/v2/PermissionsRequestApprovalResponse";
import type { ToolRequestUserInputResponse } from "./generated/protocol/v2/ToolRequestUserInputResponse";

export interface ServerRequestResponseMap {
  "account/chatgptAuthTokens/refresh": ChatgptAuthTokensRefreshResponse;
  "applyPatchApproval": ApplyPatchApprovalResponse;
  "attestation/generate": AttestationGenerateResponse;
  "currentTime/read": CurrentTimeReadResponse;
  "execCommandApproval": ExecCommandApprovalResponse;
  "item/commandExecution/requestApproval": CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": FileChangeRequestApprovalResponse;
  "item/permissions/requestApproval": PermissionsRequestApprovalResponse;
  "item/tool/call": DynamicToolCallResponse;
  "item/tool/requestUserInput": ToolRequestUserInputResponse;
  "mcpServer/elicitation/request": McpServerElicitationRequestResponse;
}

export type ServerRequestMethod = keyof ServerRequestResponseMap;
export type ServerRequestFor<M extends ServerRequestMethod> = Extract<
  ServerRequest,
  { method: M }
>;
export type TypedServerRequestHandler<M extends ServerRequestMethod> = (
  params: ServerRequestFor<M>["params"],
  request: ServerRequestFor<M>,
) => ServerRequestResponseMap[M] | Promise<ServerRequestResponseMap[M]>;

export type ServerNotificationMethod = ServerNotification["method"];
export type ServerNotificationFor<M extends ServerNotificationMethod> = Extract<
  ServerNotification,
  { method: M }
>;
export type TypedNotificationHandler<M extends ServerNotificationMethod> = (
  params: ServerNotificationFor<M>["params"],
  notification: ServerNotificationFor<M>,
) => void | Promise<void>;

type AssertNever<T extends never> = T;
type MissingServerRequestMethods = AssertNever<
  Exclude<ServerRequest["method"], ServerRequestMethod>
>;
type ExtraServerRequestMethods = AssertNever<
  Exclude<ServerRequestMethod, ServerRequest["method"]>
>;
