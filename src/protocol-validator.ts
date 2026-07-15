import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import baseProtocolSchema from "../schemas/codex_app_server_protocol.schemas.json" with {
  type: "json",
};
import runtimeValidationSchemas from "../schemas/runtime-validation.schemas.json" with {
  type: "json",
};
import v2ProtocolSchema from "../schemas/codex_app_server_protocol.v2.schemas.json" with {
  type: "json",
};
import {
  AppServerProtocolValidationError,
  type ProtocolValidationDirection,
  type ProtocolValidationIssue,
} from "./errors";
import { appServerResponseSchemaRefs } from "./generated/app-server-methods";
import {
  clientNotificationMethods,
  serverNotificationMethods,
} from "./generated/protocol-method-sets";
import { serverRequestResponseSchemaRefs } from "./generated/server-request-methods";
import type { JsonRpcNotification, JsonRpcRequest } from "./types";

const BASE_SCHEMA_ID = "codex://app-server/base";
const V2_SCHEMA_ID = "codex://app-server/v2";
const VALIDATION_REQUEST_ID = "protocol-validation";

export type ProtocolValidationMode = "strict" | "off";

export const protocolValidationMetadata = {
  defaultMode: "strict" as const,
  validatedClientNotifications: clientNotificationMethods.length,
  validatedClientRequests: Object.keys(appServerResponseSchemaRefs).length,
  validatedClientResponses:
    Object.keys(appServerResponseSchemaRefs).length -
    runtimeValidationSchemas.unavailableClientResponses.length,
  validatedServerRequests: Object.keys(serverRequestResponseSchemaRefs).length,
  validatedServerNotifications: serverNotificationMethods.length,
  unavailableResponseSchemas: [
    ...runtimeValidationSchemas.unavailableClientResponses,
  ] as readonly string[],
} as const;

type SchemaBundle = "base" | "v2";
type SchemaReference = { bundle: SchemaBundle; definition: string };

let sharedValidator: Promise<ProtocolValidator> | null = null;

export function loadProtocolValidator(): Promise<ProtocolValidator> {
  sharedValidator ??= Promise.resolve().then(() => new ProtocolValidator());
  return sharedValidator;
}

export class ProtocolValidator {
  private readonly ajv: Ajv;
  private readonly appServerMethods = new Set(Object.keys(appServerResponseSchemaRefs));
  private readonly clientNotifications = new Set<string>(clientNotificationMethods);
  private readonly responseValidators = new Map<string, ValidateFunction | null>();
  private readonly serverNotifications = new Set<string>(serverNotificationMethods);
  private readonly serverRequests = new Set(Object.keys(serverRequestResponseSchemaRefs));
  private readonly serverResponseValidators = new Map<string, ValidateFunction>();
  private readonly validateClientNotification: ValidateFunction;
  private readonly validateClientRequest: ValidateFunction;
  private readonly validateServerNotification: ValidateFunction;
  private readonly validateServerRequest: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      allowUnionTypes: true,
      strict: false,
      validateFormats: false,
    });
    this.ajv.addSchema(withId(baseProtocolSchema, BASE_SCHEMA_ID), BASE_SCHEMA_ID);
    this.ajv.addSchema(withId(v2ProtocolSchema, V2_SCHEMA_ID), V2_SCHEMA_ID);
    for (const [name, schema] of Object.entries(runtimeValidationSchemas.schemas)) {
      const id = runtimeSchemaId(name);
      this.ajv.addSchema(withId(schema, id), id);
    }

    this.validateClientRequest = this.requireValidator(
      `${V2_SCHEMA_ID}#/definitions/ClientRequest`,
    );
    this.validateClientNotification = this.requireValidator(
      runtimeSchemaId("ClientNotification"),
    );
    this.validateServerNotification = this.requireValidator(
      `${V2_SCHEMA_ID}#/definitions/ServerNotification`,
    );
    this.validateServerRequest = this.requireValidator(
      `${BASE_SCHEMA_ID}#/definitions/ServerRequest`,
    );

    for (const [method, reference] of Object.entries(serverRequestResponseSchemaRefs)) {
      this.serverResponseValidators.set(
        method,
        this.requireResponseValidator(reference),
      );
    }
  }

  assertClientRequest(method: string, params: unknown): void {
    if (!this.appServerMethods.has(method)) return;
    this.assertValid(
      this.validateClientRequest,
      {
        id: VALIDATION_REQUEST_ID,
        method,
        ...(params === undefined ? {} : { params }),
      },
      "request",
      method,
    );
  }

  assertClientNotification(method: string, params: unknown): void {
    if (!this.clientNotifications.has(method)) return;
    this.assertValid(
      this.validateClientNotification,
      { method, ...(params === undefined ? {} : { params }) },
      "notification",
      method,
    );
  }

  assertResponse(method: string, result: unknown): void {
    const reference = schemaReference(appServerResponseSchemaRefs, method);
    if (!reference) return;
    let validate = this.responseValidators.get(method);
    if (validate === undefined) {
      validate = this.responseValidator(reference);
      this.responseValidators.set(method, validate);
    }
    if (validate) this.assertValid(validate, result, "response", method);
  }

  assertServerNotification(notification: JsonRpcNotification): void {
    if (!this.serverNotifications.has(notification.method)) return;
    this.assertValid(
      this.validateServerNotification,
      notification,
      "notification",
      notification.method,
    );
  }

  assertServerRequest(request: JsonRpcRequest): void {
    if (!this.serverRequests.has(request.method)) return;
    this.assertValid(
      this.validateServerRequest,
      request,
      "serverRequest",
      request.method,
    );
  }

  assertServerResponse(method: string, result: unknown): void {
    const validate = this.serverResponseValidators.get(method);
    if (validate) this.assertValid(validate, result, "serverResponse", method);
  }

  private assertValid(
    validate: ValidateFunction,
    value: unknown,
    direction: ProtocolValidationDirection,
    method: string,
  ): void {
    let wireValue: unknown;
    try {
      wireValue = validationWireValue(value);
    } catch (error) {
      throw new AppServerProtocolValidationError(
        direction,
        method,
        [
          {
            instancePath: "",
            keyword: "serialization",
            message: error instanceof Error ? error.message : String(error),
            schemaPath: "",
          },
        ],
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    if (validate(wireValue)) return;
    throw new AppServerProtocolValidationError(
      direction,
      method,
      validationIssues(validate.errors),
    );
  }

  private responseValidator(reference: SchemaReference): ValidateFunction | null {
    const combined = this.ajv.getSchema(combinedSchemaRef(reference));
    if (combined) return combined;
    return this.ajv.getSchema(runtimeSchemaId(reference.definition)) ?? null;
  }

  private requireResponseValidator(reference: SchemaReference): ValidateFunction {
    const validate = this.responseValidator(reference);
    if (!validate) {
      throw new Error(`Generated response schema is missing: ${reference.definition}.`);
    }
    return validate;
  }

  private requireValidator(reference: string): ValidateFunction {
    const validate = this.ajv.getSchema(reference);
    if (!validate) throw new Error(`Generated protocol schema is missing: ${reference}.`);
    return validate;
  }
}

function schemaReference(
  map: typeof appServerResponseSchemaRefs,
  method: string,
): SchemaReference | null {
  if (!Object.hasOwn(map, method)) return null;
  return map[method as keyof typeof map];
}

function combinedSchemaRef(reference: SchemaReference): string {
  const id = reference.bundle === "v2" ? V2_SCHEMA_ID : BASE_SCHEMA_ID;
  return `${id}#/definitions/${reference.definition}`;
}

function runtimeSchemaId(definition: string): string {
  return `codex://app-server/runtime/${definition}`;
}

function withId(schema: unknown, id: string): AnySchema {
  return { ...(schema as Record<string, unknown>), $id: id } as AnySchema;
}

function validationWireValue(value: unknown): unknown {
  const serialized = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? Number(item) : item,
  );
  if (serialized === undefined) throw new TypeError("JSON value serialized to undefined.");
  return JSON.parse(serialized) as unknown;
}

function validationIssues(
  errors: ErrorObject[] | null | undefined,
): ProtocolValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    ...(error.message === undefined ? {} : { message: error.message }),
    schemaPath: error.schemaPath,
  }));
}
