import type { ServerNotification } from "./generated/protocol/ServerNotification";
export type {
  ServerRequestFor,
  ServerRequestMethod,
  ServerRequestResponseMap,
  TypedServerRequestHandler,
} from "./generated/server-request-methods";

export type ServerNotificationMethod = ServerNotification["method"];
export type ServerNotificationFor<M extends ServerNotificationMethod> = Extract<
  ServerNotification,
  { method: M }
>;
export type TypedNotificationHandler<M extends ServerNotificationMethod> = (
  params: ServerNotificationFor<M>["params"],
  notification: ServerNotificationFor<M>,
) => void | Promise<void>;
