import "dotenv/config";
import { z } from "zod";

import { ConfigurationError } from "./errors.js";

export type McpTransport = "stdio" | "http";

export interface PersonalOsApiConfig {
  baseUrl: URL;
  token: string;
  timeoutMs: number;
}

export interface AppConfig extends Omit<PersonalOsApiConfig, "token"> {
  token?: string;
  transport: McpTransport;
  publicUrl?: URL;
  authorizationServerUrl?: URL;
  port: number;
}

const timeoutSchema = z.coerce.number().int().positive().max(300);
const transportSchema = z.enum(["stdio", "http"]);
const portSchema = z.coerce.number().int().positive().max(65_535);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawBaseUrl = env.PERSONAL_OS_BASE_URL?.trim();
  const token = env.PERSONAL_OS_AI_TOKEN?.trim();

  if (!rawBaseUrl) {
    throw new ConfigurationError("PERSONAL_OS_BASE_URL is required.");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new ConfigurationError("PERSONAL_OS_BASE_URL must be a valid HTTP(S) URL.");
  }

  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new ConfigurationError("PERSONAL_OS_BASE_URL must use HTTP or HTTPS.");
  }

  const parsedTimeout = timeoutSchema.safeParse(env.PERSONAL_OS_MCP_TIMEOUT_SECONDS ?? "15");
  if (!parsedTimeout.success) {
    throw new ConfigurationError(
      "PERSONAL_OS_MCP_TIMEOUT_SECONDS must be an integer between 1 and 300.",
    );
  }
  const parsedTransport = transportSchema.safeParse(env.MCP_TRANSPORT?.trim() || "stdio");
  if (!parsedTransport.success) {
    throw new ConfigurationError("MCP_TRANSPORT must be either stdio or http.");
  }
  if (parsedTransport.data === "stdio" && !token) {
    throw new ConfigurationError("PERSONAL_OS_AI_TOKEN is required for stdio transport.");
  }
  let authorizationServerUrl: URL | undefined;
  let publicUrl: URL | undefined;
  if (parsedTransport.data === "http") {
    try {
      publicUrl = new URL(env.MCP_PUBLIC_URL?.trim() || "");
    } catch {
      throw new ConfigurationError(
        "MCP_PUBLIC_URL is required in HTTP mode and must be a valid URL.",
      );
    }
    if (!["http:", "https:"].includes(publicUrl.protocol) || publicUrl.pathname !== "/mcp") {
      throw new ConfigurationError("MCP_PUBLIC_URL must be an HTTP(S) URL ending in /mcp.");
    }

    try {
      authorizationServerUrl = new URL(env.PERSONAL_OS_OAUTH_ISSUER_URL?.trim() || baseUrl.origin);
    } catch {
      throw new ConfigurationError("PERSONAL_OS_OAUTH_ISSUER_URL must be a valid URL.");
    }
  }

  const parsedPort = portSchema.safeParse(env.PORT?.trim() || "8080");
  if (!parsedPort.success) {
    throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  }

  return {
    baseUrl,
    ...(token ? { token } : {}),
    timeoutMs: parsedTimeout.data * 1000,
    transport: parsedTransport.data,
    port: parsedPort.data,
    ...(publicUrl ? { publicUrl } : {}),
    ...(authorizationServerUrl ? { authorizationServerUrl } : {}),
  };
}
