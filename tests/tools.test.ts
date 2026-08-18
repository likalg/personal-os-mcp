import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { PersonalOsClient } from "../src/http-client.js";
import { createServer } from "../src/server.js";
import { executeTool, toolDefinitions } from "../src/tools.js";

const requiredNames = [
  "personal_os_health",
  "personal_os_capabilities",
  "personal_os_list_tasks",
  "personal_os_get_task",
  "personal_os_create_task",
  "personal_os_update_task",
  "personal_os_bulk_update_tasks",
  "personal_os_complete_task",
  "personal_os_reopen_task",
  "personal_os_archive_task",
  "personal_os_unarchive_task",
  "personal_os_move_task_to_trash",
  "personal_os_restore_task",
  "personal_os_update_task_planning",
  "personal_os_create_task_step",
  "personal_os_update_task_step",
  "personal_os_delete_task_step",
  "personal_os_list_tags",
  "personal_os_get_tag",
  "personal_os_create_tag",
  "personal_os_update_tag",
  "personal_os_archive_tag",
  "personal_os_restore_tag",
  "personal_os_delete_tag",
  "personal_os_list_containers",
  "personal_os_get_container",
  "personal_os_create_container",
  "personal_os_update_container",
  "personal_os_archive_container",
  "personal_os_restore_container",
  "personal_os_delete_container",
  "personal_os_list_projects",
  "personal_os_get_project",
  "personal_os_create_project",
  "personal_os_update_project",
  "personal_os_archive_project",
  "personal_os_restore_project",
  "personal_os_delete_project",
  "personal_os_list_collections",
  "personal_os_get_collection",
  "personal_os_create_collection",
  "personal_os_update_collection",
  "personal_os_archive_collection",
  "personal_os_restore_collection",
  "personal_os_delete_collection",
  "personal_os_list_notes",
  "personal_os_get_note",
  "personal_os_create_note",
  "personal_os_update_note",
  "personal_os_complete_note",
  "personal_os_uncomplete_note",
  "personal_os_archive_note",
  "personal_os_restore_note",
  "personal_os_delete_note",
  "personal_os_list_inbox_items",
  "personal_os_list_archive_items",
  "personal_os_list_planning_items",
  "personal_os_list_planning_tasks",
  "personal_os_get_task_planning",
  "personal_os_list_reviews",
  "personal_os_list_review_types",
  "personal_os_get_review",
  "personal_os_start_review",
  "personal_os_update_review_section",
  "personal_os_apply_review_action",
  "personal_os_skip_review_item",
  "personal_os_complete_review",
  "personal_os_abandon_review",
  "personal_os_get_review_summary",
];

function fakeClient() {
  return {
    request: vi.fn(async (request) => ({ echoed: request })),
  } as unknown as PersonalOsClient & { request: ReturnType<typeof vi.fn> };
}

describe("MCP tool registry", () => {
  it("registers every requested practical tool exactly once with the prefix", () => {
    const names = toolDefinitions.map(({ name }) => name);
    expect(names).toHaveLength(requiredNames.length);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(requiredNames.sort());
    expect(names.every((name) => name.startsWith("personal_os_"))).toBe(true);
  });

  it("can construct the official MCP server with every registered definition", () => {
    expect(createServer(fakeClient())).toBeDefined();
  });

  it("completes the MCP handshake and exposes every tool through tools/list", async () => {
    const server = createServer(fakeClient());
    const client = new Client({ name: "registry-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();

    expect(listed.tools).toHaveLength(toolDefinitions.length);
    expect(listed.tools.map(({ name }) => name).sort()).toEqual(
      toolDefinitions.map(({ name }) => name).sort(),
    );
    expect(listed.tools.every(({ inputSchema }) => inputSchema.type === "object")).toBe(true);

    await client.close();
    await server.close();
  });

  it("rejects unknown fields and invalid enum/limit values before HTTP", async () => {
    const client = fakeClient();

    await expect(
      executeTool("personal_os_list_tasks", { state: "invalid" }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_list_tasks", { limit: 201 }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_health", { token: "must-not-be-accepted" }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("maps Task create, partial update, bulk, lifecycle, Trash, and planning requests", async () => {
    const client = fakeClient();
    const taskId = "018f7f15-2345-7abc-8def-1234567890ab";
    const containerId = "018f7f15-2345-7abc-8def-1234567890ac";

    await executeTool(
      "personal_os_create_task",
      { container_id: containerId, title: "Write docs", priority: "p1" },
      client,
    );
    await executeTool("personal_os_update_task", { task_id: taskId, feels_heavy: true }, client);
    await executeTool(
      "personal_os_bulk_update_tasks",
      { tasks: [{ id: taskId, status: "next" }] },
      client,
    );
    await executeTool("personal_os_complete_task", { task_id: taskId }, client);
    await executeTool("personal_os_move_task_to_trash", { task_id: taskId }, client);
    await executeTool(
      "personal_os_update_task_planning",
      { task_id: taskId, timeline: "scheduled", scheduled_date: "2026-08-01" },
      client,
    );

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: "POST", path: "/api/v1/ai/tasks" }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PATCH",
        path: `/api/v1/ai/tasks/${taskId}`,
        body: { feels_heavy: true },
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ method: "PATCH", path: "/api/v1/ai/tasks/bulk" }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ method: "DELETE", path: `/api/v1/ai/tasks/${taskId}` }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        method: "PATCH",
        path: `/api/v1/ai/tasks/${taskId}/planning`,
        body: { timeline: "scheduled", scheduled_date: "2026-08-01" },
      }),
    );
  });

  it("hides Effort from exposed Task inputs while retaining current state and Feels Heavy controls", async () => {
    const client = fakeClient();
    const taskId = "018f7f15-2345-7abc-8def-1234567890ab";
    const containerId = "018f7f15-2345-7abc-8def-1234567890ac";

    await expect(
      executeTool(
        "personal_os_create_task",
        { container_id: containerId, title: "Hidden option", effort: "deep_focus" },
        client,
      ),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_update_task", { task_id: taskId, effort: "deep_focus" }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });

    await executeTool(
      "personal_os_update_task",
      { task_id: taskId, work_state: "in_progress", feels_heavy: true },
      client,
    );
    expect(client.request).toHaveBeenCalledOnce();
  });

  it("maps current Task filters, sorting, and Step operations directly to AI API routes", async () => {
    const client = fakeClient();
    const taskId = "018f7f15-2345-7abc-8def-1234567890ab";
    const stepId = "018f7f15-2345-7abc-8def-1234567890ad";

    await executeTool(
      "personal_os_list_tasks",
      { work_state: "in_progress", feels_heavy: true, priority: "p1", sort: "priority" },
      client,
    );
    await executeTool(
      "personal_os_create_task_step",
      { task_id: taskId, title: "Open the form" },
      client,
    );
    await executeTool("personal_os_update_task_step", { step_id: stepId, is_done: true }, client);
    await executeTool("personal_os_delete_task_step", { step_id: stepId }, client);

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/ai/tasks",
        query: expect.objectContaining({
          work_state: "in_progress",
          feels_heavy: true,
          priority: "p1",
          sort: "priority",
        }),
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: `/api/v1/ai/tasks/${taskId}/steps`,
      operation: "create task step",
      body: { title: "Open the form" },
    });
    expect(client.request).toHaveBeenNthCalledWith(3, {
      method: "PATCH",
      path: `/api/v1/ai/task-steps/${stepId}`,
      operation: "update task step",
      body: { is_done: true },
    });
    expect(client.request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ method: "DELETE", path: `/api/v1/ai/task-steps/${stepId}` }),
    );
  });

  it("maps estimated_minutes for Task create, update (including clearing), and list filters", async () => {
    const client = fakeClient();
    const taskId = "018f7f15-2345-7abc-8def-1234567890ab";
    const containerId = "018f7f15-2345-7abc-8def-1234567890ac";

    await executeTool(
      "personal_os_create_task",
      { container_id: containerId, title: "Deep work block", estimated_minutes: 90 },
      client,
    );
    await executeTool(
      "personal_os_update_task",
      { task_id: taskId, estimated_minutes: 45 },
      client,
    );
    await executeTool(
      "personal_os_update_task",
      { task_id: taskId, estimated_minutes: null },
      client,
    );
    await executeTool(
      "personal_os_list_tasks",
      { estimated_minutes: 5, min_estimated_minutes: 30, max_estimated_minutes: 60 },
      client,
    );

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/ai/tasks",
        body: expect.objectContaining({ estimated_minutes: 90 }),
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PATCH",
        path: `/api/v1/ai/tasks/${taskId}`,
        body: { estimated_minutes: 45 },
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "PATCH",
        path: `/api/v1/ai/tasks/${taskId}`,
        body: { estimated_minutes: null },
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/ai/tasks",
        query: expect.objectContaining({
          estimated_minutes: 5,
          min_estimated_minutes: 30,
          max_estimated_minutes: 60,
        }),
      }),
    );
  });

  it("rejects invalid estimated_minutes values and an inverted min/max range before HTTP", async () => {
    const client = fakeClient();
    const containerId = "018f7f15-2345-7abc-8def-1234567890ac";

    await expect(
      executeTool("personal_os_list_tasks", { estimated_minutes: 0 }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_list_tasks", { estimated_minutes: -5 }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_list_tasks", { estimated_minutes: 10_081 }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool("personal_os_list_tasks", { estimated_minutes: 1.5 }, client),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool(
        "personal_os_list_tasks",
        { min_estimated_minutes: 120, max_estimated_minutes: 60 },
        client,
      ),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    await expect(
      executeTool(
        "personal_os_create_task",
        { container_id: containerId, title: "Bad estimate", estimated_minutes: 0 },
        client,
      ),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });

    expect(client.request).not.toHaveBeenCalled();
  });

  it("accepts and forwards Tag descriptions for create and partial update", async () => {
    const client = fakeClient();
    const tagId = "018f7f15-2345-7abc-8def-1234567890ab";

    await executeTool(
      "personal_os_create_tag",
      {
        name: "Personal OS",
        description: "Tasks and references related to the Personal OS product.",
      },
      client,
    );
    await executeTool(
      "personal_os_update_tag",
      {
        tag_id: tagId,
        description: "Updated Tag context.",
      },
      client,
    );

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/api/v1/ai/tags",
      operation: "create tag",
      body: {
        name: "Personal OS",
        description: "Tasks and references related to the Personal OS product.",
      },
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: "PATCH",
      path: `/api/v1/ai/tags/${tagId}`,
      operation: "update tag",
      body: { description: "Updated Tag context." },
    });
  });

  it("rejects Tag descriptions longer than the Personal OS API limit", async () => {
    const client = fakeClient();

    await expect(
      executeTool(
        "personal_os_create_tag",
        { name: "Too long", description: "a".repeat(1_001) },
        client,
      ),
    ).resolves.toMatchObject({ error: { type: "invalid_arguments" } });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("maps all resource families and review actions to existing AI routes", async () => {
    const client = fakeClient();
    const id = "018f7f15-2345-7abc-8def-1234567890ab";

    await executeTool("personal_os_get_tag", { tag_id: id }, client);
    await executeTool("personal_os_create_container", { type: "area", name: "Work" }, client);
    await executeTool("personal_os_create_project", { area_id: id, name: "Launch" }, client);
    await executeTool("personal_os_create_collection", { name: "Reading" }, client);
    await executeTool("personal_os_create_note", { body: "Reference" }, client);
    await executeTool("personal_os_list_inbox_items", {}, client);
    await executeTool("personal_os_list_planning_tasks", { view: "today" }, client);
    await executeTool(
      "personal_os_apply_review_action",
      { session_id: id, item_id: id, action: "keep" },
      client,
    );

    const paths = client.request.mock.calls.map(([request]) => request.path);
    expect(paths).toEqual([
      `/api/v1/ai/tags/${id}`,
      "/api/v1/ai/containers",
      "/api/v1/ai/projects",
      "/api/v1/ai/collections",
      "/api/v1/ai/notes",
      "/api/v1/ai/items",
      "/api/v1/ai/planning/tasks",
      `/api/v1/ai/review-sessions/${id}/items/${id}/action`,
    ]);
  });

  it("forwards the shared Note Tag set for create and update", async () => {
    const client = fakeClient();
    const noteId = "018f7f15-2345-7abc-8def-1234567890ab";
    const tagId = "018f7f15-2345-7abc-8def-1234567890ac";

    await executeTool(
      "personal_os_create_note",
      { body: "Tagged reference", tag_ids: [tagId] },
      client,
    );
    await executeTool("personal_os_update_note", { note_id: noteId, tag_ids: [] }, client);

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/api/v1/ai/notes",
      operation: "create note",
      body: { body: "Tagged reference", tag_ids: [tagId] },
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: "PATCH",
      path: `/api/v1/ai/notes/${noteId}`,
      operation: "update note",
      body: { tag_ids: [] },
    });
  });

  it("marks final delete, bulk, Trash, archive, and review abandon as destructive", () => {
    const destructive = toolDefinitions
      .filter(({ annotations }) => annotations.destructiveHint)
      .map(({ name }) => name);

    expect(destructive).toEqual(
      expect.arrayContaining([
        "personal_os_bulk_update_tasks",
        "personal_os_move_task_to_trash",
        "personal_os_archive_task",
        "personal_os_delete_tag",
        "personal_os_delete_container",
        "personal_os_delete_project",
        "personal_os_delete_collection",
        "personal_os_delete_note",
        "personal_os_delete_task_step",
        "personal_os_abandon_review",
      ]),
    );
    expect(
      toolDefinitions.find(({ name }) => name === "personal_os_list_tasks")?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("keeps Collection as a Container projection and exposes no collection-item mutation", () => {
    expect(toolDefinitions.some(({ name }) => name.includes("collection_item"))).toBe(false);
  });
});
