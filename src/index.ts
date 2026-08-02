#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { PersonalOsClient } from "./http-client.js";
import { startHttpServer } from "./http-server.js";
import { createServer } from "./server.js";

const HTTP_HOST = "0.0.0.0";
const MCP_PATH = "/mcp";
const HEALTHCHECK_PATH = "/healthz";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new PersonalOsClient(config);

  if (config.transport === "http") {
    // Logged before binding so the process's very first output proves this
    // entrypoint actually ran, even if the subsequent listen() call fails.
    process.stdout.write("=== PERSONAL OS MCP HTTP SERVER STARTING ===\n");
    process.stdout.write(`Resolved host: ${HTTP_HOST}\n`);
    process.stdout.write(`Resolved port: ${config.port}\n`);
    process.stdout.write("Transport mode: streamable-http\n");
    process.stdout.write(`MCP endpoint path: ${MCP_PATH}\n`);
    process.stdout.write(`Healthcheck path: ${HEALTHCHECK_PATH}\n`);
    process.stdout.write(`Personal OS API base URL: ${config.baseUrl.toString()}\n`);

    const httpServer = await startHttpServer(client, { host: HTTP_HOST, port: config.port });
    process.stdout.write(`Personal OS MCP HTTP server listening on ${HTTP_HOST}:${config.port}\n`);

    const shutdown = (signal: NodeJS.Signals): void => {
      process.stdout.write(`Received ${signal}, shutting down Personal OS MCP HTTP server...\n`);
      httpServer.close((error) => {
        if (error) {
          process.stderr.write("Personal OS MCP HTTP server failed to shut down cleanly.\n");
          process.exitCode = 1;
        }
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    return;
  }

  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigurationError ? error.message : "Personal OS MCP server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
