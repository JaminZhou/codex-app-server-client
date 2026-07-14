export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type RequestId = number | string;

export interface JsonRpcErrorData {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccessResponse {
  id: RequestId;
  result: JsonValue;
}

export interface JsonRpcErrorResponse {
  id: RequestId;
  error: JsonRpcErrorData;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface InitializeCapabilities {
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
  requestAttestation?: boolean;
}

export interface InitializeResponse {
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
  userAgent?: string;
  [key: string]: JsonValue | undefined;
}

export type NotificationHandler = (
  notification: JsonRpcNotification,
) => void | Promise<void>;

export type ServerRequestHandler = (
  request: JsonRpcRequest,
) => JsonValue | Promise<JsonValue>;
