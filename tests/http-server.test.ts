import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { AppConfig } from "../src/config.js";
import { startHttpServer } from "../src/http-server.js";
import { toolDefinitions } from "../src/tools.js";

const testConfig = {
  baseUrl: new URL("http://personal-os.example.test"),
  token: "never-log-this-test-token",
  timeoutMs: 1_000,
  transport: "http",
  port: 3000,
  publicUrl: new URL("http://127.0.0.1/mcp"),
  authorizationServerUrl: new URL("https://personal-os.example.test"),
} satisfies AppConfig;

describe("Streamable HTTP transport", () => {
  let origin: string;
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let upstreamFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    upstreamFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get("authorization") !== "Bearer user-one-token") {
        return new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 });
      }
      return new Response(JSON.stringify({ data: { status: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    server = await startHttpServer(
      testConfig,
      { host: "127.0.0.1", port: 0 },
      { fetch: upstreamFetch },
    );
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("starts and serves a secret-free health response", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      service: "personal-os-mcp",
      transport: "streamable-http",
    });
    expect(JSON.stringify(body)).not.toContain(testConfig.token);
  });

  it("serves a Railway-compatible /healthz probe with no API dependency", async () => {
    const response = await fetch(`${origin}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body.trim()).toBe("OK");
  });

  it("supports CORS preflight for remote MCP clients", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://chatgpt.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
  });

  it("publishes OAuth protected-resource metadata", async () => {
    const response = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: "http://127.0.0.1/mcp",
      authorization_servers: ["https://personal-os.example.test"],
      scopes_supported: ["personal_os", "offline_access"],
    });
  });

  it("completes the MCP handshake and lists all existing tools", async () => {
    const client = new Client({
      name: "personal-os-mcp-http-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: {
        headers: { Authorization: "Bearer user-one-token" },
      },
    });

    try {
      await client.connect(transport as Transport);
      const result = await client.listTools();

      expect(result.tools).toHaveLength(toolDefinitions.length);
      expect(result.tools.map(({ name }) => name)).toContain("personal_os_health");
      expect(result.tools.map(({ name }) => name)).toContain("personal_os_get_review_summary");
    } finally {
      expect(upstreamFetch).toHaveBeenCalled();
      await client.close();
    }
  });

  it("rejects unauthenticated MCP requests without exposing secrets", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: "{",
    });
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(body).not.toContain(testConfig.token);
  });
});
