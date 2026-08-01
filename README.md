# Personal OS MCP

Independent Model Context Protocol server for the Personal OS AI API. It exposes the same practical, typed MCP tools over local `stdio` or remote Streamable HTTP and performs every real operation through the existing HTTP API.

```text
MCP client → personal-os-mcp → Personal OS /api/v1/ai/* → Personal OS database
```

The server never connects to MySQL, imports Laravel internals, accepts a User ID, or reproduces Personal OS ownership and lifecycle logic. Personal OS remains authoritative.

## Technology

- Node.js 20 or newer
- Node.js 22.7.5 or newer when running the current MCP Inspector
- TypeScript with strict checking
- Official `@modelcontextprotocol/sdk` 1.30
- Zod schemas
- Native Node `fetch`
- Vitest, ESLint, and Prettier
- Local `stdio` and remote stateless Streamable HTTP transports

## Setup

Personal OS must be available locally, normally at `http://localhost:8080`.

```bash
cd /home/lika/projects/personal-os-mcp
npm install
cp .env.example .env
```

Create a dedicated User-bound AI token from the Personal OS project:

```bash
cd /home/lika/projects/personal-os
docker compose exec app php artisan ai:token user@example.com --name=chatgpt
```

Use the actual account email interactively. The token is displayed once. Store it only in the local ignored `.env` file or a secret manager:

```env
MCP_TRANSPORT=stdio
PORT=3000
PERSONAL_OS_BASE_URL=http://localhost:8080
PERSONAL_OS_AI_TOKEN=replace_with_the_once_displayed_token
PERSONAL_OS_MCP_TIMEOUT_SECONDS=15
```

Never commit, log, paste into documentation, or place a real token in `.env.example`.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm start
npm test
npm run lint
npm run format:check
```

Development mode runs TypeScript directly. `npm run build` writes ESM output to `dist`; `npm start` runs the built server using `MCP_TRANSPORT`.

## Local stdio

`stdio` is the default transport and remains suitable for local clients and MCP Inspector:

```bash
MCP_TRANSPORT=stdio npm start
```

Inspect the built server with the official MCP Inspector:

```bash
npm run build
MCP_TRANSPORT=stdio npx @modelcontextprotocol/inspector node dist/index.js
```

Protocol messages use stdout in this mode. Configuration failures use stderr without printing the token or environment.

## Remote Streamable HTTP

HTTP mode binds to `0.0.0.0`, listens on `PORT`, and exposes:

- `POST /mcp` — stateless MCP Streamable HTTP;
- `GET /health` — process health;
- `OPTIONS /mcp` and `OPTIONS /health` — CORS preflight.

Start it locally:

```bash
MCP_TRANSPORT=http PORT=3000 npm start
```

The public MCP URL is `https://YOUR_PUBLIC_HOST/mcp`.

For the requested development topology:

```text
ChatGPT → Railway personal-os-mcp → PERSONAL_OS_BASE_URL (ngrok) → local Personal OS
```

The Personal OS AI token stays only in the MCP service environment. It is never returned by `/health`, included in MCP errors, or written to logs. Because this stage intentionally adds no OAuth, anyone who can reach the public MCP URL can invoke the User-bound tools. Rotate or revoke the AI token when the endpoint is no longer needed.

### Railway

The repository includes a multi-stage `Dockerfile` and minimal `railway.json`. Configure:

```env
MCP_TRANSPORT=http
PERSONAL_OS_BASE_URL=https://<your-personal-os-railway-domain>
PERSONAL_OS_AI_TOKEN=your_secret_ai_token
PERSONAL_OS_MCP_TIMEOUT_SECONDS=15
```

`PERSONAL_OS_BASE_URL` should point at the deployed Personal OS web service's
public URL once that app is also on Railway (see
`personal-os/docs/deployment/railway.md` in that repo). For local-only
experimentation against a Personal OS instance that isn't deployed yet, an
ngrok tunnel to your local Personal OS works the same way — any reachable
HTTPS origin is accepted.

`PERSONAL_OS_AI_TOKEN` is minted from the Personal OS app itself, not from
this repo: `php artisan ai:token <email> --name=mcp` (see that app's
`app/Console/Commands/CreateAiToken.php`). Treat it as a secret — it grants
the bearer the `ai:access` ability scoped to that one Laravel user's data.

Railway supplies `PORT`; do not hardcode it. The start command is `npm start`, and Railway checks `/health`. No database, persistent volume, OAuth service, or Personal OS deployment is required in this repo — only network access to wherever Personal OS is running.

Verify locally with `curl http://127.0.0.1:3000/health`. For MCP Inspector, run `npx @modelcontextprotocol/inspector`, select Streamable HTTP, and use `http://127.0.0.1:3000/mcp`.

## Tools

### System

- `personal_os_health`
- `personal_os_capabilities`

### Tasks and Planning

- `personal_os_list_tasks`
- `personal_os_get_task`
- `personal_os_create_task`
- `personal_os_update_task`
- `personal_os_bulk_update_tasks`
- `personal_os_complete_task`
- `personal_os_reopen_task`
- `personal_os_archive_task`
- `personal_os_unarchive_task`
- `personal_os_move_task_to_trash`
- `personal_os_restore_task`
- `personal_os_update_task_planning`
- `personal_os_list_planning_tasks`
- `personal_os_get_task_planning`

Task create and update tools accept the optional `estimated_minutes` field: a nullable integer from 1 to 10080 representing the Task's total estimated duration in minutes (never hours/minutes pairs, decimal hours, or time-of-day strings). Send `null` to clear an existing estimate. `personal_os_list_tasks` supports three numeric duration filters: `estimated_minutes` (exact match), `min_estimated_minutes` (inclusive minimum), and `max_estimated_minutes` (inclusive maximum) — map natural-language duration requests to these, e.g. "5-minute tasks" -> `estimated_minutes: 5`, "under 30 minutes" -> `max_estimated_minutes: 30`, "one to two hours" -> `min_estimated_minutes: 60, max_estimated_minutes: 120`.

### Tags

- `personal_os_list_tags`
- `personal_os_get_tag`
- `personal_os_create_tag`
- `personal_os_update_tag`
- `personal_os_archive_tag`
- `personal_os_restore_tag`
- `personal_os_delete_tag`

Tag create and update tools accept the optional `description` field (maximum 1,000 characters) and forward it unchanged to the Personal OS AI API.

### Containers / Lists

- `personal_os_list_containers`
- `personal_os_get_container`
- `personal_os_create_container`
- `personal_os_update_container`
- `personal_os_archive_container`
- `personal_os_restore_container`
- `personal_os_delete_container`

### Projects

- `personal_os_list_projects`
- `personal_os_get_project`
- `personal_os_create_project`
- `personal_os_update_project`
- `personal_os_archive_project`
- `personal_os_restore_project`
- `personal_os_delete_project`

### Collections

- `personal_os_list_collections`
- `personal_os_get_collection`
- `personal_os_create_collection`
- `personal_os_update_collection`
- `personal_os_archive_collection`
- `personal_os_restore_collection`
- `personal_os_delete_collection`

A Collection is a root-level Task Container. There is no collection-item model or item mutation tool.

### Notes

- `personal_os_list_notes`
- `personal_os_get_note`
- `personal_os_create_note`
- `personal_os_update_note`
- `personal_os_complete_note`
- `personal_os_uncomplete_note`
- `personal_os_archive_note`
- `personal_os_restore_note`
- `personal_os_delete_note`

### Unified Items

- `personal_os_list_inbox_items`
- `personal_os_list_archive_items`
- `personal_os_list_planning_items`

### Reviews

- `personal_os_list_reviews`
- `personal_os_list_review_types`
- `personal_os_get_review`
- `personal_os_start_review`
- `personal_os_update_review_section`
- `personal_os_apply_review_action`
- `personal_os_skip_review_item`
- `personal_os_complete_review`
- `personal_os_abandon_review`
- `personal_os_get_review_summary`

## Safety metadata

MCP annotations use only SDK-supported fields: `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`.

Confirmation is recommended for:

- every permanent delete tool;
- bulk Task update;
- moving a Task to Trash;
- archive actions;
- abandoning a Review;
- Review item actions because an action may mutate or delete its source.

Lifecycle meanings:

- **Trash:** recoverable Task soft delete; `personal_os_restore_task` can recover it.
- **Archive:** reversible removal from active views; the matching restore/unarchive action reactivates it.
- **Final delete:** permanent and irreversible; applies to Containers, Projects, Collections, Tags, and Notes.

The MCP protocol annotations inform compatible hosts, but the server does not create a custom Accept/Reject UI.

## HTTP and errors

The centralized client sends `Accept: application/json`, JSON bodies where applicable, and a redacted Bearer token header. It safely joins base paths, omits null/empty query values, applies a configurable timeout, validates JSON response shape, and returns structured tool errors:

- `authentication` for 401
- `authorization` for 403
- `not_found` for 404 or foreign-owned IDs
- `validation` with field errors for 422
- `rate_limited` for 429
- `upstream` for 5xx
- `network`, `timeout`, `invalid_json`, or `contract` for transport/response failures

Only transient connection/timeout failures on GET requests are retried, at most twice after the initial attempt. Mutations are never retried automatically.

Unhandled errors inside an HTTP `/mcp` request handler (transport/protocol failures, not upstream API errors — those are already structured above) are logged to stderr with sensitive values redacted, in addition to the generic JSON-RPC 500 sent to the client. Railway captures container stderr as service logs, so these are visible without extra configuration.

## Security boundary

- One local token represents exactly one Personal OS User.
- The token must have the `ai:access` ability and `ai-api:` name prefix.
- Normal application tokens cannot call the AI namespace.
- AI tokens cannot call normal User/admin endpoints.
- Authorization values are never included in tool errors.
- `.env` and `.env.*` are ignored except `.env.example`.

## Known limitations

- Streamable HTTP is stateless and intentionally has no OAuth or inbound authentication at this stage.
- No OAuth or multi-user token selector.
- No Reminders, Recurrences, or Checklist mutation tools.
- No ChatGPT widget, custom frontend, or Accept/Reject UI.
- Tool schemas are maintained as a typed projection of Laravel routes, Form Requests, enums, Resources, and capabilities because Personal OS currently publishes no OpenAPI document.

Future stages may add the explicitly deferred domains, inbound authorization, and richer ChatGPT integration after their security and deployment decisions are approved.
