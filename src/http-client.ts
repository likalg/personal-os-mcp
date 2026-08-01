import { z } from "zod";

import type { PersonalOsApiConfig } from "./config.js";
import { PersonalOsApiError, redactSensitive, type ErrorKind } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions<T> {
  method: HttpMethod;
  path: string;
  operation: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  responseSchema?: z.ZodType<T>;
}

export interface ClientDependencies {
  fetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultResponseSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

export class PersonalOsClient {
  private readonly fetcher: typeof fetch;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly config: PersonalOsApiConfig,
    dependencies: ClientDependencies = {},
  ) {
    this.fetcher = dependencies.fetch ?? fetch;
    this.wait =
      dependencies.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async request<T = unknown>(options: ApiRequestOptions<T>): Promise<T> {
    const maximumAttempts = options.method === "GET" ? 3 : 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await this.attempt(options);
      } catch (error) {
        if (!this.shouldRetry(error, options.method, attempt, maximumAttempts)) {
          throw error;
        }
        await this.wait(100 * 2 ** (attempt - 1));
      }
    }

    throw new Error("Unreachable retry state.");
  }

  private async attempt<T>(options: ApiRequestOptions<T>): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: options.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.token}`,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: controller.signal,
      };
      if (options.body !== undefined) {
        requestInit.body = JSON.stringify(options.body);
      }
      response = await this.fetcher(url, requestInit);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new PersonalOsApiError({
        type: timedOut ? "timeout" : "network",
        status: null,
        message: timedOut
          ? `Personal OS request timed out during ${options.operation}.`
          : `Could not reach Personal OS during ${options.operation}.`,
        field_errors: {},
        retryable: options.method === "GET",
        operation: options.operation,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) {
      return null as T;
    }

    const raw = await response.text();
    let payload: unknown;
    try {
      payload = raw === "" ? null : JSON.parse(raw);
    } catch {
      throw new PersonalOsApiError({
        type: "invalid_json",
        status: response.status,
        message: `Personal OS returned invalid JSON during ${options.operation}.`,
        field_errors: {},
        retryable: false,
        operation: options.operation,
      });
    }

    if (!response.ok) {
      throw this.httpError(response.status, payload, options.operation);
    }

    const schema = options.responseSchema ?? defaultResponseSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PersonalOsApiError({
        type: "contract",
        status: response.status,
        message: `Personal OS returned an unexpected response during ${options.operation}.`,
        field_errors: {},
        retryable: false,
        operation: options.operation,
      });
    }

    return parsed.data as T;
  }

  private buildUrl(path: string, query: Record<string, QueryValue> = {}): URL {
    const base = new URL(this.config.baseUrl.toString());
    const basePath = base.pathname.replace(/\/+$/, "");
    const requestPath = path.replace(/^\/+/, "");
    base.pathname = `${basePath}/${requestPath}`.replace(/\/{2,}/g, "/");
    base.search = "";
    base.hash = "";

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      base.searchParams.set(key, String(value));
    }

    return base;
  }

  private httpError(status: number, payload: unknown, operation: string): PersonalOsApiError {
    const body = z
      .object({
        message: z.string().optional(),
        errors: z.record(z.string(), z.array(z.string())).optional(),
      })
      .passthrough()
      .safeParse(payload);
    const kind: ErrorKind =
      status === 401
        ? "authentication"
        : status === 403
          ? "authorization"
          : status === 404
            ? "not_found"
            : status === 422
              ? "validation"
              : status === 429
                ? "rate_limited"
                : "upstream";
    const fallback =
      status >= 500 ? "Personal OS API failed." : `Personal OS returned HTTP ${status}.`;
    const message = body.success ? (body.data.message ?? fallback) : fallback;

    return new PersonalOsApiError({
      type: kind,
      status,
      message: redactSensitive(message, this.config.token),
      field_errors: body.success ? (body.data.errors ?? {}) : {},
      retryable: status === 429 || status >= 500,
      operation,
    });
  }

  private shouldRetry(
    error: unknown,
    method: HttpMethod,
    attempt: number,
    maximumAttempts: number,
  ): boolean {
    return (
      method === "GET" &&
      attempt < maximumAttempts &&
      error instanceof PersonalOsApiError &&
      ["network", "timeout"].includes(error.details.type)
    );
  }
}
