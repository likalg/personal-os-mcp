import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalOsApiError } from "../src/errors.js";
import { PersonalOsClient } from "../src/http-client.js";

let server: Server;
let baseUrl: URL;
const token = "test-ai-token";

beforeEach(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname.endsWith("/invalid-json")) {
        response.writeHead(200, { "Content-Type": "application/json" }).end("not-json");
        return;
      }
      if (url.pathname.endsWith("/unexpected")) {
        response.writeHead(200, { "Content-Type": "application/json" }).end('"scalar"');
        return;
      }
      const status = Number(url.searchParams.get("status") ?? 200);
      if (status !== 200) {
        response.writeHead(status, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            message: `Request failed; Authorization: Bearer ${token}`,
            errors: status === 422 ? { title: ["The title field is required."] } : undefined,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          method: request.method,
          authorization: request.headers.authorization,
          accept: request.headers.accept,
          content_type: request.headers["content-type"] ?? null,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing mock server address.");
  baseUrl = new URL(`http://127.0.0.1:${address.port}/root/`);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function client(timeoutMs = 1_000): PersonalOsClient {
  return new PersonalOsClient({ baseUrl, token, timeoutMs }, { wait: async () => undefined });
}

describe("PersonalOsClient", () => {
  it("joins base paths, omits empty query values, and sends bearer JSON requests", async () => {
    const response = (await client().request({
      method: "POST",
      path: "/api/v1/ai/tasks",
      operation: "create task",
      query: { state: "active", search: "", nullable: null, missing: undefined, limit: 10 },
      body: { title: "Ship" },
    })) as Record<string, unknown>;

    expect(response).toMatchObject({
      method: "POST",
      authorization: `Bearer ${token}`,
      accept: "application/json",
      content_type: "application/json",
      path: "/root/api/v1/ai/tasks",
      query: { state: "active", limit: "10" },
      body: { title: "Ship" },
    });
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [404, "not_found"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "upstream"],
  ])("maps HTTP %i to %s and redacts authorization", async (status, kind) => {
    const promise = client().request({
      method: "GET",
      path: "/error",
      operation: "mapped error",
      query: { status },
    });

    await expect(promise).rejects.toMatchObject({
      details: {
        type: kind,
        status,
        operation: "mapped error",
      },
    });

    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(PersonalOsApiError);
      expect(JSON.stringify(error)).not.toContain(token);
      if (status === 422 && error instanceof PersonalOsApiError) {
        expect(error.details.field_errors).toEqual({
          title: ["The title field is required."],
        });
      }
    }
  });

  it("rejects invalid JSON", async () => {
    await expect(
      client().request({ method: "GET", path: "/invalid-json", operation: "invalid JSON" }),
    ).rejects.toMatchObject({ details: { type: "invalid_json" } });
  });

  it("rejects an unexpected response shape", async () => {
    await expect(
      client().request({ method: "GET", path: "/unexpected", operation: "contract check" }),
    ).rejects.toMatchObject({ details: { type: "contract" } });
  });

  it("retries transient GET network failures only", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = new PersonalOsClient(
      { baseUrl, token, timeoutMs: 1_000 },
      { fetch: fetcher, wait: async () => undefined },
    );

    await expect(
      api.request({ method: "GET", path: "/retry", operation: "read retry" }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockClear().mockRejectedValue(new TypeError("connection reset"));
    await expect(
      api.request({ method: "POST", path: "/no-retry", operation: "mutation" }),
    ).rejects.toMatchObject({ details: { type: "network", retryable: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout without exposing the token", async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const api = new PersonalOsClient(
      { baseUrl, token, timeoutMs: 5 },
      { fetch: fetcher, wait: async () => undefined },
    );

    await expect(
      api.request({ method: "POST", path: "/timeout", operation: "timed mutation" }),
    ).rejects.toMatchObject({ details: { type: "timeout", retryable: false } });
  });
});
