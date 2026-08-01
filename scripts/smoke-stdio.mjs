import { webcrypto } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const client = new Client({ name: "personal-os-mcp-stdio-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, MCP_TRANSPORT: "stdio" },
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 66) {
    throw new Error(`Expected 66 tools, received ${tools.length}.`);
  }
  process.stdout.write(`stdio smoke ok: ${tools.length} tools\n`);
} finally {
  await client.close();
}
