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

import { redactSensitive } from "./errors.js";
import type { PersonalOsClient } from "./http-client.js";
import { createServer as createMcpServer } from "./server.js";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "Accept, Authorization, Content-Type, Last-Event-ID, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
} as const;

interface StartHttpServerOptions {
  host?: string;
  port: number;
}

export function createHttpServer(client: PersonalOsClient): Server {
  return createNodeServer((request, response) => {
    applyCors(response);
    void routeRequest(request, response, client);
  });
}

export async function startHttpServer(
  client: PersonalOsClient,
  { host = "0.0.0.0", port }: StartHttpServerOptions,
): Promise<Server> {
  const server = createHttpServer(client);

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
  client: PersonalOsClient,
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

  if (pathname !== "/mcp") {
    writeJson(response, 404, { error: "Not found." });
    return;
  }

  if (method !== "POST") {
    methodNotAllowed(response, ["POST", "OPTIONS"], true);
    return;
  }

  await handleMcpRequest(request, response, client);
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
