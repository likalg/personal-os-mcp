import { z } from "zod";

export const uuid = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");
export const time = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Expected H:i or H:i:s.");

export const taskStatuses = [
  "inbox",
  "next",
  "in_progress",
  "waiting",
  "completed",
  "cancelled",
] as const;
export const taskPriorities = ["none", "p1", "p2", "p3", "p4"] as const;
export const taskWorkStates = ["idle", "in_progress", "later"] as const;
export const taskSorts = ["newest", "priority"] as const;
export const taskEfforts = ["quick_win", "deep_focus", "low_energy", "high_physical"] as const;
export const containerTypes = [
  "inbox",
  "area",
  "project",
  "collection",
  "reach_out",
  "someday",
] as const;
export const taskStates = ["active", "archived", "completed", "trash", "all"] as const;
export const planningTargets = ["today", "tomorrow", "someday", "scheduled", "unplanned"] as const;
export const planningViews = [
  "today",
  "tomorrow",
  "someday",
  "scheduled",
  "future",
  "overdue",
  "unplanned",
  "no_due_date",
] as const;
export const reviewTypes = ["inbox", "weekly", "someday", "overdue", "stale", "archived"] as const;
export const reviewActions = [
  "keep",
  "schedule_today",
  "schedule_tomorrow",
  "schedule_date",
  "someday",
  "move_inbox",
  "complete",
  "remove_due_date",
  "reschedule_due",
  "archive",
  "restore",
  "delete",
  "assign_container",
  "assign_tags",
] as const;
export const noteBackgroundColors = ["sand", "rose", "mint", "sky", "lavender"] as const;

const taskMutableShape = {
  container_id: uuid.describe("Owned active non-Area Container UUID."),
  title: z.string().min(1).max(500),
  description: z.string().max(60_000).nullable(),
  status: z.enum(taskStatuses),
  work_state: z.enum(taskWorkStates),
  feels_heavy: z.boolean(),
  feels_heavy_focus_started_at: z.string().min(1).nullable(),
  feels_heavy_gain_note: z.string().max(2_000).nullable(),
  feels_heavy_self_message: z.string().max(2_000).nullable(),
  steps_finalized: z.boolean(),
  priority: z.enum(taskPriorities),
  // Temporarily hidden from UI; keep implementation for future re-enable.
  effort: z.enum(taskEfforts),
  estimated_minutes: z
    .number()
    .int()
    .min(1)
    .max(10_080)
    .nullable()
    .describe(
      "Estimated total minutes to complete the Task (1-10080). Always total minutes — never send strings like '1.5 hours' or '1:30'. Null clears the estimate.",
    ),
  planned_for_date: date.nullable(),
  due_date: date.nullable(),
  due_at: z
    .string()
    .min(1)
    .nullable()
    .describe("Date/time accepted by the API; UTC ISO 8601 is recommended."),
  sort_order: z.number().int().min(0),
  tag_ids: z.array(uuid).max(100),
};

export const responseDepth = z
  .enum(["summary", "full"])
  .optional()
  .describe(
    "Response depth. Defaults to summary; request full only when complete item content is required.",
  );

export const paginationFields = {
  page: z.number().int().min(1).optional().describe("Page number to return."),
  per_page: z.number().int().min(1).max(100).optional().describe("Results per page (maximum 100)."),
  fetch_all: z
    .boolean()
    .optional()
    .describe(
      "Set true only when the user explicitly asks for every matching result. Fetching is safely capped.",
    ),
};

export const listTasksInput = z
  .object({
    state: z.enum(taskStates).optional(),
    status: z.enum(taskStatuses).optional(),
    work_state: z.enum(taskWorkStates).optional(),
    feels_heavy: z.boolean().optional(),
    priority: z.enum(taskPriorities).optional(),
    tag_id: uuid.optional(),
    project_id: uuid.optional(),
    container_id: uuid.optional(),
    planned_for_date: date.optional(),
    detail: responseDepth,
    estimated_minutes: z
      .number()
      .int()
      .min(1)
      .max(10_080)
      .optional()
      .describe("Exact total minutes."),
    min_estimated_minutes: z
      .number()
      .int()
      .min(1)
      .max(10_080)
      .optional()
      .describe("Minimum total minutes (inclusive)."),
    max_estimated_minutes: z
      .number()
      .int()
      .min(1)
      .max(10_080)
      .optional()
      .describe("Maximum total minutes (inclusive)."),
    search: z.string().max(500).optional(),
    sort: z.enum(taskSorts).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    ...paginationFields,
  })
  .strict()
  .refine(
    (value) =>
      value.min_estimated_minutes === undefined ||
      value.max_estimated_minutes === undefined ||
      value.min_estimated_minutes <= value.max_estimated_minutes,
    {
      message: "min_estimated_minutes must be <= max_estimated_minutes.",
      path: ["min_estimated_minutes"],
    },
  );

export const createTaskInput = z
  .object({
    container_id: taskMutableShape.container_id,
    title: taskMutableShape.title,
    description: taskMutableShape.description.optional(),
    status: taskMutableShape.status.optional(),
    work_state: taskMutableShape.work_state.optional(),
    feels_heavy: taskMutableShape.feels_heavy.optional(),
    priority: taskMutableShape.priority.optional(),
    estimated_minutes: taskMutableShape.estimated_minutes.optional(),
    planned_for_date: taskMutableShape.planned_for_date.optional(),
    due_date: taskMutableShape.due_date.optional(),
    due_at: taskMutableShape.due_at.optional(),
    sort_order: taskMutableShape.sort_order.optional(),
    tag_ids: taskMutableShape.tag_ids.optional(),
  })
  .strict();

export const updateTaskFields = z
  .object({
    container_id: taskMutableShape.container_id.optional(),
    title: taskMutableShape.title.optional(),
    description: taskMutableShape.description.optional(),
    status: taskMutableShape.status.optional(),
    work_state: taskMutableShape.work_state.optional(),
    feels_heavy: taskMutableShape.feels_heavy.optional(),
    feels_heavy_focus_started_at: taskMutableShape.feels_heavy_focus_started_at.optional(),
    feels_heavy_gain_note: taskMutableShape.feels_heavy_gain_note.optional(),
    feels_heavy_self_message: taskMutableShape.feels_heavy_self_message.optional(),
    steps_finalized: taskMutableShape.steps_finalized.optional(),
    priority: taskMutableShape.priority.optional(),
    estimated_minutes: taskMutableShape.estimated_minutes.optional(),
    planned_for_date: taskMutableShape.planned_for_date.optional(),
    due_date: taskMutableShape.due_date.optional(),
    due_at: taskMutableShape.due_at.optional(),
    sort_order: taskMutableShape.sort_order.optional(),
    tag_ids: taskMutableShape.tag_ids.optional(),
  })
  .strict();

export const createTaskStepInput = z
  .object({
    task_id: uuid,
    title: z.string().min(1).max(500),
  })
  .strict();

export const updateTaskStepInput = z
  .object({
    step_id: uuid,
    title: z.string().min(1).max(500).optional(),
    is_done: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.is_done !== undefined, {
    message: "At least one Step field is required.",
  });

export const bulkUpdateTasksInput = z
  .object({
    tasks: z
      .array(updateTaskFields.extend({ id: uuid }))
      .min(1)
      .max(100),
  })
  .strict();

export const updatePlanningInput = z
  .object({
    task_id: uuid,
    timeline: z.enum(planningTargets).optional(),
    scheduled_date: date.nullable().optional(),
    due_date: date.nullable().optional(),
    due_time: time.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.timeline !== undefined || value.due_date !== undefined || value.due_time !== undefined,
    { message: "At least one planning or due field is required." },
  )
  .refine((value) => value.timeline === "scheduled" || value.scheduled_date === undefined, {
    message: "scheduled_date is allowed only when timeline is scheduled.",
    path: ["scheduled_date"],
  })
  .refine((value) => value.timeline !== "scheduled" || value.scheduled_date != null, {
    message: "scheduled_date is required when timeline is scheduled.",
    path: ["scheduled_date"],
  });

export const listPlanningInput = z
  .object({
    view: z.enum(planningViews),
    date: date.optional(),
  })
  .strict()
  .refine((value) => value.view === "scheduled" || value.date === undefined, {
    message: "date is allowed only for the scheduled view.",
    path: ["date"],
  })
  .refine((value) => value.view !== "scheduled" || value.date !== undefined, {
    message: "date is required for the scheduled view.",
    path: ["date"],
  });

export const createContainerInput = z
  .object({
    type: z.enum(containerTypes),
    name: z.string().min(1).max(160),
    description: z.string().max(10_000).nullable().optional(),
    parent_container_id: uuid.nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .strict();

export const updateContainerFields = createContainerInput.partial().strict();

export const createProjectInput = z
  .object({
    area_id: uuid,
    name: z.string().min(1).max(160),
    description: z.string().max(10_000).nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .strict();
export const updateProjectFields = createProjectInput.partial().strict();

export const createCollectionInput = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(10_000).nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .strict();
export const updateCollectionFields = createCollectionInput.partial().strict();

export const createTagInput = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1_000).nullable().optional(),
    emoji: z.string().max(32).nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
  })
  .strict();
export const updateTagFields = createTagInput.partial().strict();

export const createNoteInput = z
  .object({
    title: z.string().max(500).nullable().optional(),
    body: z.string().max(60_000),
    background_color: z.enum(noteBackgroundColors).nullable().optional(),
    container_id: uuid.nullable().optional(),
    in_inbox: z.boolean().optional(),
    planning_type: z.enum(["unplanned", "scheduled", "someday"]).optional(),
    planned_for_date: date.nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
    tag_ids: z.array(uuid).max(100).optional(),
  })
  .strict();
export const updateNoteFields = createNoteInput.partial().strict();

export const reviewActionInput = z
  .object({
    session_id: uuid,
    item_id: uuid,
    action: z.enum(reviewActions),
    date: date.nullable().optional(),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Expected H:i.")
      .nullable()
      .optional(),
    container_id: uuid.nullable().optional(),
    tag_ids: z.array(uuid).max(100).optional(),
  })
  .strict();
