import {
  CodexAppServerClient,
  protocolValidationMetadata,
} from "../dist/index.js";

if (protocolValidationMetadata.validatedClientRequests !== 125) {
  throw new Error("Built runtime validation metadata is incomplete.");
}

const client = new CodexAppServerClient({ protocolValidation: "strict" });
if (client.state !== "disconnected") {
  throw new Error(`Unexpected initial client state: ${client.state}`);
}

console.log(`Node ${process.versions.node} runtime smoke passed.`);
