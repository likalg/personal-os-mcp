import "dotenv/config";
import { z } from "zod";

import { ConfigurationError } from "./errors.js";

export interface AppConfig {
  baseUrl: URL;
  token: string;
  timeoutMs: number;
}

const timeoutSchema = z.coerce.number().int().positive().max(300);

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

  return {
    baseUrl,
    token,
    timeoutMs: parsedTimeout.data * 1000,
  };
}
