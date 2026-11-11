# AI assistant: how the parts fit together (#179)

The shared contract for building the assistant in parallel. Change it only with
a commit here that every part can see. The rules behind it are in issue #179.

## Rules every part follows

- **The agent is untrusted, always.** Limits are enforced by the backend, never
  by instructions to the agent and never by the page.
- **Off by default.** With the setting off, no assistant route does anything but
  report that it's off, and nothing is sent anywhere.
- **Off in `container` and `hosted` modes**, via a new `assistant` capability in
  `backend/app/services/deployment_mode.py`.
- **Writing a model and opening it amount to running code.** Unreviewed
  assistant-written Python never runs with the user's permissions, by any route.
- **There is no tool for running models** in this round. The containment that
  would need is Phase 4.
- **Agents never get the general API.** Only the tools in `TOOL_ALLOWLIST`.

## Code layout

| Part | Location | Owner |
|---|---|---|
| Threat model, containment findings | `docs/ai-assistant/` | Security docs |
| Settings, keys, agent connection, session loop, tools, routes | `backend/app/services/assistant/`, `backend/app/api/assistant_routes.py` | Backend |
| Folder rules, file tools, review state, execution guard | `backend/app/services/assistant/files.py`, `review.py` | Files |
| Panel, Settings section, applying proposals | `frontend/src/components/assistant/`, `frontend/src/stores/assistantStore.ts`, `frontend/src/components/common/settings/AssistantSection.tsx` | Frontend |

## Settings, stored by the backend

`GET /api/assistant/settings` and `PUT /api/assistant/settings`:

```json
{
  "enabled": false,
  "agent": {"type": "none", "model": "", "base_url": ""},
  "folders": [{"path": "~/Models", "access": "read"}],
  "autonomy": "suggest",
  "saving": "always_ask",
  "visibility": {"model": true, "selection": true, "errors": true, "results": false, "files": false},
  "limits": {"tool_calls": 25, "minutes": 10},
  "keep_log": true
}
```

- `agent.type`: `none`, `anthropic`, `openai_compatible`.
- `autonomy`: `answer`, `suggest`, `app_edits`.
- `saving`: `always_ask`, `structured_without_asking`.
- `folders[].access`: `read`, `read_write`.
- A `PUT` that raises a permission must carry `"confirm_raise": true`, or it gets a 409 naming what would be raised. The page asks the user first.

`GET /api/assistant/key` returns `{"set": bool}`, never the key. `PUT` takes `{"key": "..."}`. `DELETE` removes it.

## Sessions

- `POST /api/assistant/sessions` returns `{"id": "..."}`.
- `POST /api/assistant/sessions/{id}/messages` takes `{"text": "...", "context": {...}}` and returns `{"turn_id": "..."}`. It starts the turn and doesn't wait for it.
- `GET /api/assistant/sessions/{id}/events?after=N` returns `{"events": [...], "next": M, "running": bool}`. The page polls this, and marks it as a background request in `busyStore`.
- `POST /api/assistant/sessions/{id}/stop` ends the turn at once.

`context` is what the page can see: `{"file_path", "source", "selection", "errors", "results"}`. The backend drops anything `visibility` doesn't allow before the agent sees it.

Each event has `{"seq", "t", "type", ...}`:

| `type` | Fields |
|---|---|
| `text` | `text` |
| `tool_call` | `tool`, `args` |
| `tool_result` | `tool`, `ok`, `summary` |
| `refused` | `tool`, `reason` |
| `proposal` | `proposal` (below) |
| `error` | `message` |
| `done` | `reason`: `finished`, `stopped`, `limit` |

## Proposals

```json
{
  "id": "...",
  "kind": "app_edit | file_write",
  "summary": "Raise gain on a to 2",
  "state": "pending | accepted | rejected | stale",
  "base_hash": "sha256 of the source the agent last read",
  "ops": [{"op": "update_param", "args": {}}],
  "path": null,
  "before": "...",
  "after": "...",
  "freeform_python": false,
  "warnings": []
}
```

- `POST /api/assistant/proposals/{id}/reject` rejects one.
- `POST /api/assistant/proposals/{id}/accept` takes `{"current_hash": "..."}`. If that differs from `base_hash`, it returns 409 and the proposal goes `stale`. The agent has to look again, so the user's work is never overwritten.
- **App edits are applied by the page**, through the same edit paths the user's own edits take, as one History entry labelled `Assistant: <summary>`, so one undo reverses it.
- **File writes are applied by the backend** on accept, through `files.py`, after keeping the previous version.

## Tools: `TOOL_ALLOWLIST`

| Tool | Does | Needs |
|---|---|---|
| `read_open_model` | Returns what `context` allows | Always |
| `read_docs` | Searches PsyNeuView and PsyNeuLink docs | Always |
| `propose_app_edit` | Creates an `app_edit` proposal | `autonomy` isn't `answer` |
| `list_files` | Lists model files in allowed folders | `visibility.files` |
| `read_file` | Reads a model file's text, **without running it** | `visibility.files` |
| `propose_file_write` | Creates a `file_write` proposal | A `read_write` folder |
| `propose_open_file` | Asks the user to open a file; only the user can accept | `visibility.files` |

## `files.py` and `review.py`

```python
def resolve_allowed(path: str, *, write: bool = False) -> Path: ...  # raises PathRefused
def list_model_files() -> list[dict]: ...
def read_model_file(path: str) -> str: ...
def write_model_file(path: str, text: str, *, base_hash: str | None) -> Path: ...  # keeps previous version

def mark_unreviewed(path: str, text: str) -> None: ...
def mark_reviewed(path: str, text: str) -> None: ...
def is_runnable(path: str, text: str) -> bool: ...  # False only for unreviewed assistant-written content
```

`is_runnable` must be consulted by every route that executes a model: `/model/load`, reload from the file watcher, autosave's reload, undo and redo. A route that would execute unreviewed content answers 409 with `reason: "assistant_code_unreviewed"`, `path`, and under `approve` the two calls below.

### Reviewing assistant-written files

- `POST /api/assistant/review/status` takes `{"path"}` and returns `{"path", "tracked", "runnable"}`; for a tracked file also `content` and `content_hash` (sha256), so the page shows exactly what an approval covers.
- `POST /api/assistant/review/approve` takes `{"path", "content_hash"}` and approves only if the file on disk still hashes to `content_hash`. Otherwise 409 with `reason: "assistant_code_changed"` and the current `content_hash`, and the file stays unreviewed. Any later change to an approved file makes it unreviewed again.
- Every assistant route, these included, accepts requests only from the app's own page (`same_site` dependency); anything else gets 403 with `reason: "not_app_page"`.

## Log

`GET /api/assistant/log` returns every tool call, its arguments, the result, whether it was allowed, and who approved it. Local only. Prompts, replies and source stay out of problem reports.
