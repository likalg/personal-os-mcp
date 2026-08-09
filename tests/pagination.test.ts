import { describe, expect, it, vi } from "vitest";

import type { PersonalOsClient } from "../src/http-client.js";
import { executeTool, toolDefinitions } from "../src/tools.js";

function page(currentPage: number, lastPage: number, prefix = "task") {
  return {
    data: [{ id: `${prefix}-${currentPage}` }],
    links: { first: "/first", last: "/last", prev: null, next: null },
    meta: {
      current_page: currentPage,
      from: currentPage,
      last_page: lastPage,
      path: "/api/v1/ai/tasks",
      per_page: 1,
      to: currentPage,
      total: lastPage,
    },
  };
}

function clientWith(
  implementation: (request: Record<string, unknown>) => Promise<unknown>,
): PersonalOsClient & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(implementation),
  } as unknown as PersonalOsClient & { request: ReturnType<typeof vi.fn> };
}

describe("paginated task-list compatibility", () => {
  it("validates safe pagination controls on every paginated list tool", () => {
    for (const name of [
      "personal_os_list_tasks",
      "personal_os_list_inbox_items",
      "personal_os_list_archive_items",
      "personal_os_list_planning_items",
    ]) {
      const definition = toolDefinitions.find((candidate) => candidate.name === name);
      expect(definition).toBeDefined();

      const required = name === "personal_os_list_planning_items" ? { view: "today" } : {};
      expect(
        definition?.inputSchema.safeParse({
          ...required,
          page: 2,
          per_page: 100,
          fetch_all: true,
        }).success,
      ).toBe(true);
      expect(definition?.inputSchema.safeParse({ ...required, page: 0 }).success).toBe(false);
      expect(definition?.inputSchema.safeParse({ ...required, per_page: 101 }).success).toBe(false);
    }
  });

  it("returns one page for normal requests and clearly indicates additional pages", async () => {
    const client = clientWith(async () => page(2, 4));

    const response = await executeTool(
      "personal_os_list_tasks",
      { search: "roadmap", page: 2, per_page: 25 },
      client,
    );

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          search: "roadmap",
          page: 2,
          per_page: 25,
          representation: "summary",
        }),
      }),
    );
    expect(response).toMatchObject({
      result: {
        data: [{ id: "task-2" }],
        pagination: {
          mode: "page",
          has_more: true,
          truncated: false,
          pages_fetched: 1,
          next_page: 3,
        },
      },
    });
  });

  it("fetches every available page only when explicitly requested and preserves filters", async () => {
    const projectId = "018f7f15-2345-7abc-8def-1234567890ab";
    const client = clientWith(async (request) => {
      const query = request.query as Record<string, unknown>;
      return page(Number(query.page ?? 1), 3);
    });

    const response = await executeTool(
      "personal_os_list_tasks",
      {
        state: "active",
        project_id: projectId,
        search: "roadmap",
        page: 1,
        per_page: 25,
        fetch_all: true,
      },
      client,
    );

    expect(client.request).toHaveBeenCalledTimes(3);
    for (const [request] of client.request.mock.calls) {
      expect(request.query).toMatchObject({
        state: "active",
        project_id: projectId,
        search: "roadmap",
        per_page: 25,
        representation: "summary",
      });
      expect(request.query).not.toHaveProperty("fetch_all");
    }
    expect(client.request.mock.calls.map(([request]) => request.query.page)).toEqual([1, 2, 3]);
    expect(response).toMatchObject({
      result: {
        data: [{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }],
        pagination: {
          mode: "all",
          has_more: false,
          truncated: false,
          pages_fetched: 3,
          next_page: null,
          maximum_pages: 10,
        },
      },
    });
  });

  it("caps explicit all requests and reports truncation", async () => {
    const client = clientWith(async (request) => {
      const query = request.query as Record<string, unknown>;
      return page(Number(query.page ?? 1), 20);
    });

    const response = await executeTool(
      "personal_os_list_tasks",
      { fetch_all: true, per_page: 1 },
      client,
    );

    expect(client.request).toHaveBeenCalledTimes(10);
    expect(response).toMatchObject({
      result: {
        data: Array.from({ length: 10 }, (_, index) => ({ id: `task-${index + 1}` })),
        pagination: {
          mode: "all",
          has_more: true,
          truncated: true,
          pages_fetched: 10,
          next_page: 11,
        },
      },
    });
  });

  it("supports bounded all-page retrieval for mixed Inbox items", async () => {
    const client = clientWith(async (request) => {
      const query = request.query as Record<string, unknown>;
      return page(Number(query.page ?? 1), 2, "item");
    });

    const response = await executeTool(
      "personal_os_list_inbox_items",
      { search: "notes", fetch_all: true },
      client,
    );

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: expect.objectContaining({
          view: "inbox",
          search: "notes",
          page: 2,
          representation: "summary",
        }),
      }),
    );
    expect(response).toMatchObject({
      result: {
        data: [{ id: "item-1" }, { id: "item-2" }],
        pagination: { truncated: false, pages_fetched: 2 },
      },
    });
  });

  it("preserves an explicit full representation across safely fetched pages", async () => {
    const client = clientWith(async (request) => {
      const query = request.query as Record<string, unknown>;
      return page(Number(query.page ?? 1), 2);
    });

    await executeTool(
      "personal_os_list_tasks",
      { detail: "full", search: "deep analysis", fetch_all: true },
      client,
    );

    expect(client.request).toHaveBeenCalledTimes(2);
    for (const [request] of client.request.mock.calls) {
      expect(request.query).toMatchObject({
        representation: "full",
        search: "deep analysis",
      });
      expect(request.query).not.toHaveProperty("detail");
    }
  });

  it("uses summary for Notes and dedicated endpoints for single-item detail", async () => {
    const noteId = "018f7f15-2345-7abc-8def-1234567890ab";
    const client = clientWith(async () => ({ data: [] }));

    await executeTool("personal_os_list_notes", {}, client);
    await executeTool("personal_os_get_note", { note_id: noteId }, client);

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "/api/v1/ai/notes",
        query: { representation: "summary" },
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: `/api/v1/ai/notes/${noteId}` }),
    );
  });
});
