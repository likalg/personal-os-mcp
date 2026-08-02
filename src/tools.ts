import { z } from "zod";

import {
  bulkUpdateTasksInput,
  createCollectionInput,
  createContainerInput,
  createNoteInput,
  createProjectInput,
  createTagInput,
  createTaskInput,
  listPlanningInput,
  listTasksInput,
  paginationFields,
  reviewActionInput,
  reviewTypes,
  updateCollectionFields,
  updateContainerFields,
  updateNoteFields,
  updatePlanningInput,
  updateProjectFields,
  updateTagFields,
  updateTaskFields,
  uuid,
} from "./contracts.js";
import { PersonalOsApiError } from "./errors.js";
import type { ApiRequestOptions, PersonalOsClient } from "./http-client.js";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  annotations: ToolAnnotations;
  request: (input: Record<string, unknown>) => ApiRequestOptions<unknown>;
}

const empty = z.object({}).strict();
const identifier = (name: string) => z.object({ [name]: uuid }).strict();
const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const mutation: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const reversibleDestructive: ToolAnnotations = {
  ...mutation,
  destructiveHint: true,
};
const finalDelete: ToolAnnotations = {
  ...reversibleDestructive,
  idempotentHint: false,
};

function id(input: Record<string, unknown>, key: string): string {
  return encodeURIComponent(String(input[key]));
}

function bodyWithout(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: ToolDefinition["inputSchema"],
  annotations: ToolAnnotations,
  request: ToolDefinition["request"],
): ToolDefinition {
  return { name, title, description, inputSchema, annotations, request };
}

function lifecycleTool(
  resource: string,
  action: string,
  description: string,
  annotations: ToolAnnotations = mutation,
): ToolDefinition {
  const key = `${resource}_id`;
  return tool(
    `personal_os_${action}_${resource}`,
    `${action.replaceAll("_", " ")} ${resource}`,
    description,
    identifier(key),
    annotations,
    (input) => ({
      method: "POST",
      path: `/api/v1/ai/${resource}s/${id(input, key)}/${action.replaceAll("_", "-")}`,
      operation: `${action} ${resource}`,
    }),
  );
}

function typedContainerTools(
  resource: "project" | "collection",
  createSchema: z.AnyZodObject,
  updateSchema: z.AnyZodObject,
): ToolDefinition[] {
  const plural = `${resource}s`;
  const key = `${resource}_id`;
  const label = resource[0]?.toUpperCase() + resource.slice(1);
  return [
    tool(
      `personal_os_list_${plural}`,
      `List ${label}s`,
      `List active owned ${label}s. ${label} is a typed Container projection.`,
      empty,
      readOnly,
      () => ({ method: "GET", path: `/api/v1/ai/${plural}`, operation: `list ${plural}` }),
    ),
    tool(
      `personal_os_get_${resource}`,
      `Get ${label}`,
      `Get one owned ${label}; a foreign or wrong-typed Container is returned as not found.`,
      identifier(key),
      readOnly,
      (input) => ({
        method: "GET",
        path: `/api/v1/ai/${plural}/${id(input, key)}`,
        operation: `get ${resource}`,
      }),
    ),
    tool(
      `personal_os_create_${resource}`,
      `Create ${label}`,
      resource === "project"
        ? "Create a Project under an owned active Area."
        : "Create a root-level Collection Container for grouping Tasks; it is not a Checklist.",
      createSchema,
      mutation,
      (input) => ({
        method: "POST",
        path: `/api/v1/ai/${plural}`,
        operation: `create ${resource}`,
        body: input,
      }),
    ),
    tool(
      `personal_os_update_${resource}`,
      `Update ${label}`,
      `Partially update an owned active ${label}. Only supplied fields change.`,
      updateSchema.extend({ [key]: uuid }),
      mutation,
      (input) => ({
        method: "PATCH",
        path: `/api/v1/ai/${plural}/${id(input, key)}`,
        operation: `update ${resource}`,
        body: bodyWithout(input, [key]),
      }),
    ),
    lifecycleTool(
      resource,
      "archive",
      `Archive this ${label}. It disappears from active views but can be restored.`,
      reversibleDestructive,
    ),
    lifecycleTool(
      resource,
      "restore",
      `Restore this archived ${label}. This is archive restoration, not Trash recovery.`,
    ),
    tool(
      `personal_os_delete_${resource}`,
      `Delete ${label}`,
      `CONFIRMATION REQUIRED. Permanently and irreversibly delete this ${label}, subject to existing Container guards.`,
      identifier(key),
      finalDelete,
      (input) => ({
        method: "DELETE",
        path: `/api/v1/ai/${plural}/${id(input, key)}`,
        operation: `delete ${resource}`,
      }),
    ),
  ];
}

export const toolDefinitions: ToolDefinition[] = [
  tool(
    "personal_os_health",
    "Personal OS health",
    "Check authenticated Personal OS AI API availability without exposing sensitive data.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/health", operation: "health" }),
  ),
  tool(
    "personal_os_capabilities",
    "Personal OS capabilities",
    "Read the authoritative enums, filters, actions, limits, and lifecycle capabilities advertised by Personal OS.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/capabilities", operation: "capabilities" }),
  ),

  tool(
    "personal_os_list_tasks",
    "List Tasks",
    "List one page of owned Tasks using supported filters. Defaults to 25; page size is capped at 100. Set fetch_all only for an explicit request for every matching Task; aggregation is capped and reports truncation. Duration filters are total minutes: estimated_minutes for an exact match, min_estimated_minutes/max_estimated_minutes for a range (e.g. 'under 30 minutes' -> max_estimated_minutes: 30; 'one to two hours' -> min_estimated_minutes: 60, max_estimated_minutes: 120).",
    listTasksInput,
    readOnly,
    (input) => ({
      method: "GET",
      path: "/api/v1/ai/tasks",
      operation: "list tasks",
      query: bodyWithout(input, ["fetch_all"]) as Record<
        string,
        string | number | boolean | null | undefined
      >,
    }),
  ),
  tool(
    "personal_os_get_task",
    "Get Task",
    "Get one owned Task, including its current planning and lifecycle fields.",
    identifier("task_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/tasks/${id(input, "task_id")}`,
      operation: "get task",
    }),
  ),
  tool(
    "personal_os_create_task",
    "Create Task",
    "Create one Task in an owned active non-Area Container, optionally replacing its complete Tag set.",
    createTaskInput,
    mutation,
    (input) => ({
      method: "POST",
      path: "/api/v1/ai/tasks",
      operation: "create task",
      body: input,
    }),
  ),
  tool(
    "personal_os_update_task",
    "Update Task",
    "Partially update one owned active Task. Only supplied fields change; tag_ids replaces the complete Tag set.",
    updateTaskFields.extend({ task_id: uuid }),
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/tasks/${id(input, "task_id")}`,
      operation: "update task",
      body: bodyWithout(input, ["task_id"]),
    }),
  ),
  tool(
    "personal_os_bulk_update_tasks",
    "Bulk update Tasks",
    "CONFIRMATION REQUIRED. Atomically update 1-100 Tasks; one failure rolls back the entire batch.",
    bulkUpdateTasksInput,
    reversibleDestructive,
    (input) => ({
      method: "PATCH",
      path: "/api/v1/ai/tasks/bulk",
      operation: "bulk update tasks",
      body: input,
    }),
  ),
  lifecycleTool("task", "complete", "Complete and archive this Task using the existing lifecycle."),
  lifecycleTool("task", "reopen", "Reopen a completed Task and restore its previous status."),
  lifecycleTool(
    "task",
    "archive",
    "Archive this Task without completing it. It can be unarchived.",
    reversibleDestructive,
  ),
  lifecycleTool("task", "unarchive", "Restore a manually archived Task to active visibility."),
  tool(
    "personal_os_move_task_to_trash",
    "Move Task to Trash",
    "CONFIRMATION REQUIRED. Recoverable soft delete: move an active Task to Trash; this is not final deletion.",
    identifier("task_id"),
    reversibleDestructive,
    (input) => ({
      method: "DELETE",
      path: `/api/v1/ai/tasks/${id(input, "task_id")}`,
      operation: "move task to trash",
    }),
  ),
  lifecycleTool(
    "task",
    "restore",
    "Restore an owned Task from Trash. This is Trash recovery, not archive restoration.",
  ),
  tool(
    "personal_os_update_task_planning",
    "Update Task planning",
    "Atomically update Task timeline and/or due information; Today/Tomorrow are resolved by Personal OS in the User timezone.",
    updatePlanningInput,
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/tasks/${id(input, "task_id")}/planning`,
      operation: "update task planning",
      body: bodyWithout(input, ["task_id"]),
    }),
  ),

  tool(
    "personal_os_list_tags",
    "List Tags",
    "List active owned Tags in normalized display order.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/tags", operation: "list tags" }),
  ),
  tool(
    "personal_os_get_tag",
    "Get Tag",
    "Get one owned Tag.",
    identifier("tag_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/tags/${id(input, "tag_id")}`,
      operation: "get tag",
    }),
  ),
  tool(
    "personal_os_create_tag",
    "Create Tag",
    "Create a normalized owner-scoped Tag with optional description, emoji, and color. Case/whitespace-equivalent names are duplicates.",
    createTagInput,
    mutation,
    (input) => ({ method: "POST", path: "/api/v1/ai/tags", operation: "create tag", body: input }),
  ),
  tool(
    "personal_os_update_tag",
    "Update Tag",
    "Partially update an owned active Tag, including its optional description.",
    updateTagFields.extend({ tag_id: uuid }),
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/tags/${id(input, "tag_id")}`,
      operation: "update tag",
      body: bodyWithout(input, ["tag_id"]),
    }),
  ),
  lifecycleTool(
    "tag",
    "archive",
    "Archive a Tag while preserving existing associations. It can be restored.",
    reversibleDestructive,
  ),
  lifecycleTool("tag", "restore", "Restore an archived Tag."),
  tool(
    "personal_os_delete_tag",
    "Delete Tag",
    "CONFIRMATION REQUIRED. Permanently and irreversibly delete a Tag; pivot assignments are removed.",
    identifier("tag_id"),
    finalDelete,
    (input) => ({
      method: "DELETE",
      path: `/api/v1/ai/tags/${id(input, "tag_id")}`,
      operation: "delete tag",
    }),
  ),

  tool(
    "personal_os_list_containers",
    "List Containers",
    "List the owned Container hierarchy grouped as Inbox, Areas/Projects, Collections, Reach Out, and Someday.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/containers", operation: "list containers" }),
  ),
  tool(
    "personal_os_get_container",
    "Get Container",
    "Get one owned Container/List.",
    identifier("container_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/containers/${id(input, "container_id")}`,
      operation: "get container",
    }),
  ),
  tool(
    "personal_os_create_container",
    "Create Container",
    "Create a Container/List. Tasks may use Inbox, Project, Collection, Reach Out, or Someday; Area organizes Projects.",
    createContainerInput,
    mutation,
    (input) => ({
      method: "POST",
      path: "/api/v1/ai/containers",
      operation: "create container",
      body: input,
    }),
  ),
  tool(
    "personal_os_update_container",
    "Update Container",
    "Partially update an owned Container under existing hierarchy and Inbox restrictions.",
    updateContainerFields.extend({ container_id: uuid }),
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/containers/${id(input, "container_id")}`,
      operation: "update container",
      body: bodyWithout(input, ["container_id"]),
    }),
  ),
  lifecycleTool(
    "container",
    "archive",
    "Archive a Container under existing propagation and Inbox rules. It can be restored.",
    reversibleDestructive,
  ),
  lifecycleTool("container", "restore", "Restore an archived Container and applicable children."),
  tool(
    "personal_os_delete_container",
    "Delete Container",
    "CONFIRMATION REQUIRED. Permanently and irreversibly delete a Container after existing child/content/Inbox guards.",
    identifier("container_id"),
    finalDelete,
    (input) => ({
      method: "DELETE",
      path: `/api/v1/ai/containers/${id(input, "container_id")}`,
      operation: "delete container",
    }),
  ),

  ...typedContainerTools("project", createProjectInput, updateProjectFields),
  ...typedContainerTools("collection", createCollectionInput, updateCollectionFields),

  tool(
    "personal_os_list_notes",
    "List Notes",
    "List active owned plain-text Notes.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/notes", operation: "list notes" }),
  ),
  tool(
    "personal_os_get_note",
    "Get Note",
    "Get one owned plain-text Note.",
    identifier("note_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/notes/${id(input, "note_id")}`,
      operation: "get note",
    }),
  ),
  tool(
    "personal_os_create_note",
    "Create Note",
    "Create a plain-text Note with optional eligible Container, planning, appearance, and complete Tag set.",
    createNoteInput,
    mutation,
    (input) => ({
      method: "POST",
      path: "/api/v1/ai/notes",
      operation: "create note",
      body: input,
    }),
  ),
  tool(
    "personal_os_update_note",
    "Update Note",
    "Partially update an active owned Note; tag_ids replaces the complete Tag set.",
    updateNoteFields.extend({ note_id: uuid }),
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/notes/${id(input, "note_id")}`,
      operation: "update note",
      body: bodyWithout(input, ["note_id"]),
    }),
  ),
  lifecycleTool("note", "complete", "Mark a Note complete using the existing API lifecycle."),
  lifecycleTool("note", "uncomplete", "Return a completed Note to its incomplete state."),
  lifecycleTool(
    "note",
    "archive",
    "Archive a Note. It disappears from active views but can be restored.",
    reversibleDestructive,
  ),
  lifecycleTool("note", "restore", "Restore an archived Note. This is not Trash recovery."),
  tool(
    "personal_os_delete_note",
    "Delete Note",
    "CONFIRMATION REQUIRED. Permanently and irreversibly delete this Note; Notes do not use Trash.",
    identifier("note_id"),
    finalDelete,
    (input) => ({
      method: "DELETE",
      path: `/api/v1/ai/notes/${id(input, "note_id")}`,
      operation: "delete note",
    }),
  ),

  tool(
    "personal_os_list_inbox_items",
    "List Inbox items",
    "List the bounded mixed Inbox feed of Tasks, Notes, and Checklists.",
    z.object({ search: z.string().max(200).optional(), ...paginationFields }).strict(),
    readOnly,
    (input) => ({
      method: "GET",
      path: "/api/v1/ai/items",
      operation: "list inbox items",
      query: {
        ...bodyWithout(input, ["fetch_all"]),
        view: "inbox",
      } as Record<string, string | number | boolean | null | undefined>,
    }),
  ),
  tool(
    "personal_os_list_archive_items",
    "List archived items",
    "List the bounded mixed Archive feed of Tasks, Notes, and Checklists.",
    z.object({ search: z.string().max(200).optional(), ...paginationFields }).strict(),
    readOnly,
    (input) => ({
      method: "GET",
      path: "/api/v1/ai/items",
      operation: "list archive items",
      query: {
        ...bodyWithout(input, ["fetch_all"]),
        view: "archived",
      } as Record<string, string | number | boolean | null | undefined>,
    }),
  ),
  tool(
    "personal_os_list_planning_items",
    "List planning items",
    "List mixed items for an existing unified planning view.",
    z
      .object({
        view: z.enum(["today", "tomorrow", "upcoming", "someday"]),
        search: z.string().max(200).optional(),
        ...paginationFields,
      })
      .strict(),
    readOnly,
    (input) => ({
      method: "GET",
      path: "/api/v1/ai/items",
      operation: "list planning items",
      query: bodyWithout(input, ["fetch_all"]) as Record<
        string,
        string | number | boolean | null | undefined
      >,
    }),
  ),

  tool(
    "personal_os_list_planning_tasks",
    "List planning Tasks",
    "List active Tasks in an authoritative planning view. scheduled requires a date.",
    listPlanningInput,
    readOnly,
    (input) => ({
      method: "GET",
      path: "/api/v1/ai/planning/tasks",
      operation: "list planning tasks",
      query: input as Record<string, string | number | boolean | null | undefined>,
    }),
  ),
  tool(
    "personal_os_get_task_planning",
    "Get Task planning",
    "Read one Task's current planning and due fields through the existing Task detail endpoint.",
    identifier("task_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/tasks/${id(input, "task_id")}`,
      operation: "get task planning",
    }),
  ),

  tool(
    "personal_os_list_reviews",
    "List Reviews",
    "List owned review session history.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/reviews", operation: "list reviews" }),
  ),
  tool(
    "personal_os_list_review_types",
    "List Review types",
    "List available review types and current availability.",
    empty,
    readOnly,
    () => ({ method: "GET", path: "/api/v1/ai/reviews/types", operation: "list review types" }),
  ),
  tool(
    "personal_os_get_review",
    "Get Review",
    "Get an owned review session and its snapshot items.",
    identifier("session_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}`,
      operation: "get review",
    }),
  ),
  tool(
    "personal_os_start_review",
    "Start Review",
    "Start or resume one review session of an existing ReviewType.",
    z.object({ type: z.enum(reviewTypes) }).strict(),
    mutation,
    (input) => ({
      method: "POST",
      path: "/api/v1/ai/reviews/start",
      operation: "start review",
      body: input,
    }),
  ),
  tool(
    "personal_os_update_review_section",
    "Update Review section",
    "Update the current section marker of an in-progress owned review session.",
    z.object({ session_id: uuid, current_section: z.string().max(64).nullable() }).strict(),
    mutation,
    (input) => ({
      method: "PATCH",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}`,
      operation: "update review section",
      body: bodyWithout(input, ["session_id"]),
    }),
  ),
  tool(
    "personal_os_apply_review_action",
    "Apply Review action",
    "Apply one existing ReviewAction to one snapshot item. Source lifecycle and ownership remain API-controlled.",
    reviewActionInput,
    reversibleDestructive,
    (input) => ({
      method: "POST",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}/items/${id(input, "item_id")}/action`,
      operation: "apply review action",
      body: bodyWithout(input, ["session_id", "item_id"]),
    }),
  ),
  tool(
    "personal_os_skip_review_item",
    "Skip Review item",
    "Skip one pending item in an owned review session.",
    z.object({ session_id: uuid, item_id: uuid }).strict(),
    mutation,
    (input) => ({
      method: "POST",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}/items/${id(input, "item_id")}/skip`,
      operation: "skip review item",
    }),
  ),
  tool(
    "personal_os_complete_review",
    "Complete Review",
    "Complete a review only when no pending items remain.",
    identifier("session_id"),
    mutation,
    (input) => ({
      method: "POST",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}/complete`,
      operation: "complete review",
    }),
  ),
  tool(
    "personal_os_abandon_review",
    "Abandon Review",
    "CONFIRMATION REQUIRED. Abandon an in-progress review session; history is retained.",
    identifier("session_id"),
    reversibleDestructive,
    (input) => ({
      method: "POST",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}/abandon`,
      operation: "abandon review",
    }),
  ),
  tool(
    "personal_os_get_review_summary",
    "Get Review summary",
    "Get section and action totals for an owned review session.",
    identifier("session_id"),
    readOnly,
    (input) => ({
      method: "GET",
      path: `/api/v1/ai/review-sessions/${id(input, "session_id")}/summary`,
      operation: "get review summary",
    }),
  ),
];

const paginatedToolNames = new Set([
  "personal_os_list_tasks",
  "personal_os_list_inbox_items",
  "personal_os_list_archive_items",
  "personal_os_list_planning_items",
]);
const maximumFetchAllPages = 10;

type PaginatedPayload = Record<string, unknown> & {
  data: unknown[];
  meta: Record<string, unknown> & {
    current_page: number;
    last_page: number;
  };
};

function asPaginatedPayload(value: unknown): PaginatedPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const meta = payload.meta;
  if (
    !Array.isArray(payload.data) ||
    typeof meta !== "object" ||
    meta === null ||
    typeof (meta as Record<string, unknown>).current_page !== "number" ||
    typeof (meta as Record<string, unknown>).last_page !== "number"
  ) {
    return null;
  }

  return payload as PaginatedPayload;
}

function paginationStatus(
  mode: "page" | "all",
  currentPage: number,
  lastPage: number,
  pagesFetched: number,
  metadataAvailable = true,
): Record<string, unknown> {
  const hasMore = currentPage < lastPage;

  return {
    mode,
    metadata_available: metadataAvailable,
    has_more: hasMore,
    truncated: mode === "all" && hasMore,
    pages_fetched: pagesFetched,
    next_page: hasMore ? currentPage + 1 : null,
    maximum_pages: mode === "all" ? maximumFetchAllPages : null,
  };
}

function decoratePaginatedResult(result: unknown): unknown {
  const payload = asPaginatedPayload(result);
  if (payload === null) {
    return result;
  }

  return {
    ...payload,
    pagination: paginationStatus("page", payload.meta.current_page, payload.meta.last_page, 1),
  };
}

async function collectPaginatedResult(
  firstResult: unknown,
  request: ApiRequestOptions<unknown>,
  client: PersonalOsClient,
): Promise<unknown> {
  const firstPage = asPaginatedPayload(firstResult);
  if (firstPage === null) {
    if (typeof firstResult === "object" && firstResult !== null) {
      return {
        ...firstResult,
        pagination: paginationStatus("all", 1, 2, 1, false),
      };
    }

    return firstResult;
  }

  const data = [...firstPage.data];
  let currentPage = firstPage.meta.current_page;
  let lastPage = firstPage.meta.last_page;
  let pagesFetched = 1;

  while (currentPage < lastPage && pagesFetched < maximumFetchAllPages) {
    const requestedPage = currentPage + 1;
    const nextResult = await client.request({
      ...request,
      query: { ...request.query, page: requestedPage },
    });
    const nextPage = asPaginatedPayload(nextResult);

    if (nextPage === null || nextPage.meta.current_page < requestedPage) {
      break;
    }

    data.push(...nextPage.data);
    currentPage = nextPage.meta.current_page;
    lastPage = nextPage.meta.last_page;
    pagesFetched += 1;
  }

  return {
    ...firstPage,
    data,
    pagination: paginationStatus("all", currentPage, lastPage, pagesFetched),
  };
}
const definitionsByName = new Map(
  toolDefinitions.map((definition) => [definition.name, definition]),
);

export async function executeTool(
  name: string,
  rawInput: unknown,
  client: PersonalOsClient,
): Promise<Record<string, unknown>> {
  const definition = definitionsByName.get(name);
  if (!definition) {
    return {
      error: {
        type: "invalid_arguments",
        status: null,
        message: `Unknown tool: ${name}`,
        field_errors: {},
        retryable: false,
        operation: name,
      },
    };
  }

  const parsed = definition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      error: {
        type: "invalid_arguments",
        status: null,
        message: "Invalid MCP tool arguments.",
        field_errors: parsed.error.flatten().fieldErrors,
        retryable: false,
        operation: name,
      },
    };
  }

  try {
    const input = parsed.data as Record<string, unknown>;
    const request = definition.request(input);
    const result = await client.request(request);

    if (!paginatedToolNames.has(name)) {
      return { result };
    }

    if (input.fetch_all === true) {
      return { result: await collectPaginatedResult(result, request, client) };
    }

    return { result: decoratePaginatedResult(result) };
  } catch (error) {
    if (error instanceof PersonalOsApiError) {
      return { error: error.details };
    }
    return {
      error: {
        type: "upstream",
        status: null,
        message: `Unexpected failure during ${name}.`,
        field_errors: {},
        retryable: false,
        operation: name,
      },
    };
  }
}
