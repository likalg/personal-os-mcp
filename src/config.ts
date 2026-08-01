import "dotenv/config";
import { z } from "zod";

import { ConfigurationError } from "./errors.js";

export type McpTransport = "stdio" | "http";

export interface PersonalOsApiConfig {
  baseUrl: URL;
  token: string;
  timeoutMs: number;
}

export interface AppConfig extends PersonalOsApiConfig {
  transport: McpTransport;
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

  if (!token) {
    throw new ConfigurationError("PERSONAL_OS_AI_TOKEN is required.");
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

  const parsedPort = portSchema.safeParse(env.PORT?.trim() || "3000");
  if (!parsedPort.success) {
    throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  }

  return {
    baseUrl,
    token,
    timeoutMs: parsedTimeout.data * 1000,
    transport: parsedTransport.data,
    port: parsedPort.data,
  };
}
