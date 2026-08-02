import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ConfigurationError } from "../src/errors.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("configuration", () => {
  it("loads valid values and normalizes timeout", () => {
    const config = loadConfig({
      PERSONAL_OS_BASE_URL: "http://localhost:8080/",
      PERSONAL_OS_AI_TOKEN: "test-ai-token",
      PERSONAL_OS_MCP_TIMEOUT_SECONDS: "12",
    });

    expect(config.baseUrl.toString()).toBe("http://localhost:8080/");
    expect(config.token).toBe("test-ai-token");
    expect(config.timeoutMs).toBe(12_000);
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(8080);
  });

  it("rejects a missing base URL", () => {
    expect(() => loadConfig({ PERSONAL_OS_AI_TOKEN: "test-ai-token" })).toThrow(
      "PERSONAL_OS_BASE_URL is required",
    );
  });

  it("rejects a missing token without exposing environment values", () => {
    const secret = "must-not-appear";
    let caught: unknown;
    try {
      loadConfig({ PERSONAL_OS_BASE_URL: "http://localhost:8080", OTHER_SECRET: secret });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    expect(String(caught)).not.toContain(secret);
  });

  it.each(["0", "-1", "abc", "301", "1.5"])("rejects invalid timeout %s", (timeout) => {
    expect(() =>
      loadConfig({
        PERSONAL_OS_BASE_URL: "http://localhost:8080",
        PERSONAL_OS_AI_TOKEN: "test-ai-token",
        PERSONAL_OS_MCP_TIMEOUT_SECONDS: timeout,
      }),
    ).toThrow("PERSONAL_OS_MCP_TIMEOUT_SECONDS");
  });

  it("loads HTTP transport and Railway port", () => {
    const config = loadConfig({
      MCP_TRANSPORT: "http",
      PORT: "8080",
      PERSONAL_OS_BASE_URL: "https://personal-os.example.test",
      PERSONAL_OS_AI_TOKEN: "test-ai-token",
    });

    expect(config.transport).toBe("http");
    expect(config.port).toBe(8080);
  });

  it.each(["sse", "HTTP"])("rejects invalid transport %s", (transport) => {
    expect(() =>
      loadConfig({
        MCP_TRANSPORT: transport,
        PERSONAL_OS_BASE_URL: "http://localhost:8080",
        PERSONAL_OS_AI_TOKEN: "test-ai-token",
      }),
    ).toThrow("MCP_TRANSPORT");
  });

  it.each(["0", "-1", "abc", "65536", "1.5"])("rejects invalid port %s", (port) => {
    expect(() =>
      loadConfig({
        PORT: port,
        PERSONAL_OS_BASE_URL: "http://localhost:8080",
        PERSONAL_OS_AI_TOKEN: "test-ai-token",
      }),
    ).toThrow("PORT");
  });
});
