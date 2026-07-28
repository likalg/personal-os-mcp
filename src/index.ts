#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { PersonalOsClient } from "./http-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new PersonalOsClient(config);
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigurationError ? error.message : "Personal OS MCP server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
