#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { PersonalOsClient } from "./http-client.js";
import { startHttpServer } from "./http-server.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new PersonalOsClient(config);

  if (config.transport === "http") {
    const httpServer = await startHttpServer(client, { port: config.port });
    process.stdout.write(`Personal OS MCP HTTP server listening on 0.0.0.0:${config.port}\n`);

    const shutdown = (): void => {
      httpServer.close((error) => {
        if (error) {
          process.stderr.write("Personal OS MCP HTTP server failed to shut down cleanly.\n");
          process.exitCode = 1;
        }
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
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
