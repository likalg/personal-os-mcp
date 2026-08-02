import { webcrypto } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const endpoint = new URL(process.env.MCP_HTTP_URL ?? "http://127.0.0.1:8080/mcp");
const healthUrl = new URL("/health", endpoint);
const healthResponse = await fetch(healthUrl);
if (!healthResponse.ok) {
  throw new Error(`Health check failed with HTTP ${healthResponse.status}.`);
}

const healthzUrl = new URL("/healthz", endpoint);
const healthzResponse = await fetch(healthzUrl);
if (!healthzResponse.ok) {
  throw new Error(`Railway healthcheck failed with HTTP ${healthzResponse.status}.`);
}

const client = new Client({ name: "personal-os-mcp-http-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 66) {
    throw new Error(`Expected 66 tools, received ${tools.length}.`);
  }
  process.stdout.write(`HTTP health and MCP handshake ok: ${tools.length} tools\n`);
} finally {
  await client.close();
}
