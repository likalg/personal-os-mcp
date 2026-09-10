import { webcrypto } from "node:crypto";
import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { PersonalOsApiError, redactSensitive } from "./errors.js";
import type { AppConfig, PersonalOsApiConfig } from "./config.js";
import { PersonalOsClient, type ClientDependencies } from "./http-client.js";
import { createServer as createMcpServer } from "./server.js";

type HttpServerConfig = Omit<PersonalOsApiConfig, "token"> &
  Required<Pick<AppConfig, "publicUrl" | "authorizationServerUrl">>;

const protectedResourcePaths = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "Accept, Authorization, Content-Type, Last-Event-ID, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
} as const;

interface StartHttpServerOptions {
  host?: string;
  port: number;
}

export function createHttpServer(
  config: HttpServerConfig,
  dependencies: ClientDependencies = {},
): Server {
  return createNodeServer((request, response) => {
    applyCors(response);
    void routeRequest(request, response, config, dependencies);
  });
}

export async function startHttpServer(
  config: HttpServerConfig,
  { host = "0.0.0.0", port }: StartHttpServerOptions,
  dependencies: ClientDependencies = {},
): Promise<Server> {
  const server = createHttpServer(config, dependencies);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return server;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: HttpServerConfig,
  dependencies: ClientDependencies,
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (pathname === "/health") {
    if (method !== "GET") {
      methodNotAllowed(response, ["GET", "OPTIONS"]);
      return;
    }

    writeJson(response, 200, {
      status: "ok",
      service: "personal-os-mcp",
      transport: "streamable-http",
    });
    return;
  }

  if (pathname === "/healthz") {
    if (method !== "GET") {
      methodNotAllowed(response, ["GET", "OPTIONS"]);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("OK\n");
    return;
  }

  if (protectedResourcePaths.has(pathname)) {
    if (method !== "GET") {
      methodNotAllowed(response, ["GET", "OPTIONS"]);
      return;
    }
    writeJson(response, 200, {
      resource: config.publicUrl.toString(),
      authorization_servers: [config.authorizationServerUrl.toString().replace(/\/$/, "")],
      scopes_supported: ["personal_os", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Personal OS",
    });
    return;
  }
  if (pathname !== "/mcp") {
    writeJson(response, 404, { error: "Not found." });
    return;
  }

  if (method !== "POST") {
    methodNotAllowed(response, ["POST", "OPTIONS"], true);
    return;
  }

  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    unauthorized(response, resourceMetadataUrl(config));
    return;
  }

  const requestClient = new PersonalOsClient({ ...config, token }, dependencies);
  try {
    await requestClient.request({
      method: "GET",
      path: "/api/v1/ai/mcp-health",
      query: { resource: config.publicUrl.toString() },
      operation: "authenticate MCP request",
    });
  } catch (error) {
    if (
      error instanceof PersonalOsApiError &&
      ["authentication", "authorization"].includes(error.details.type)
    ) {
      unauthorized(response, resourceMetadataUrl(config), "invalid_token");
      return;
    }
    serviceUnavailable(response);
    return;
  }

  await handleMcpRequest(request, response, requestClient);
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  client: PersonalOsClient,
): Promise<void> {
  const options = {
    sessionIdGenerator: undefined,
  } as unknown as StreamableHTTPServerTransportOptions;
  const transport = new StreamableHTTPServerTransport(options);
  const server = createMcpServer(client);
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await transport.close();
    await server.close();
  };

  response.once("close", () => {
    void close();
  });

  try {
    await server.connect(transport as Transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `personal-os-mcp: unhandled error in /mcp request: ${redactSensitive(message, "")}\n`,
    );
    if (!response.headersSent) {
      writeJson(response, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error.",
        },
        id: null,
      });
    } else {
      response.end();
    }
    await close();
  }
}

function applyCors(response: ServerResponse): void {
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.setHeader(name, value);
  }
}

function methodNotAllowed(response: ServerResponse, allowed: string[], jsonRpc = false): void {
  response.setHeader("Allow", allowed.join(", "));

  if (jsonRpc) {
    writeJson(response, 405, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
    return;
  }

  writeJson(response, 405, { error: "Method not allowed." });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function unauthorized(response: ServerResponse, metadataUrl: string, error?: string): void {
  const suffix = error ? `, error="${error}"` : "";
  response.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl}", scope="personal_os offline_access"${suffix}`,
  );

  writeJson(response, 401, {
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Authentication required.",
    },
    id: null,
  });
}

function serviceUnavailable(response: ServerResponse): void {
  response.setHeader("Retry-After", "5");
  writeJson(response, 503, {
    jsonrpc: "2.0",
    error: {
      code: -32002,
      message: "Personal OS is temporarily unavailable.",
    },
    id: null,
  });
}

function resourceMetadataUrl(config: HttpServerConfig): string {
  const url = new URL(config.publicUrl.toString());
  url.pathname = "/.well-known/oauth-protected-resource/mcp";
  return url.toString();
}
