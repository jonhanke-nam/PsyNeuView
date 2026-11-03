# AI assistant: how the parts fit together (#179)

The shared contract the parts are built to, kept in step with the code as it
is. The rules behind it are in issue #179; the threat model is in
`threat-model.md`.

## Rules every part follows

- **The agent is untrusted, always.** Limits are enforced by the backend, never
  by instructions to the agent and never by the page.
- **Off by default.** With the setting off, no assistant route does anything but
  report that it's off, and nothing is sent anywhere.
- **Off in `container` and `hosted` modes**, via the `assistant` capability in
  `backend/app/services/deployment_mode.py`.
- **Writing a model and opening it amount to running code.** Unreviewed
  assistant-written Python never runs with the user's permissions, by any route.
- **There is no tool for running models** in this round. The containment that
  would need is Phase 4.
- **Agents never get the general API.** Only the tools in `TOOL_ALLOWLIST`.
- **An app edit is structured data, never text.** The only way free-form
  Python reaches a file is a `file_write`, approved and then reviewed.

## Code layout

| Part | Location |
|---|---|
| Threat model, containment findings, review checklist | `docs/ai-assistant/` |
| Settings, keys, agent connection, session loop, tools, routes | `backend/app/services/assistant/`, `backend/app/api/assistant_routes.py` |
| Folder rules, file tools, review state, execution guard, review routes | `backend/app/services/assistant/files.py`, `review.py`, `same_site.py`, `backend/app/api/assistant_review_routes.py` |
| Panel, Settings section, applying proposals | `frontend/src/components/assistant/`, `frontend/src/stores/assistantStore.ts`, `frontend/src/utils/assistantApply.ts`, `frontend/src/components/common/settings/AssistantSection.tsx` |

## Settings, stored by the backend

`GET /api/assistant/settings` and `PUT /api/assistant/settings`:

```json
{
  "enabled": false,
  "agent": {"type": "none", "model": "", "base_url": ""},
  "folders": [{"path": "/Users/me/Models", "access": "read"}],
  "autonomy": "suggest",
  "saving": "always_ask",
  "visibility": {"model": true, "selection": true, "errors": true, "results": false, "files": false},
  "limits": {"tool_calls": 25, "minutes": 10, "max_tokens": 100000},
  "keep_log": true
}
```

- `agent.type`: `none`, `anthropic`, `openai_compatible`. `base_url` must be
  `https`, or `http` to this machine only.
- `autonomy`: `answer`, `suggest`, `app_edits`.
- `saving`: `always_ask`, `structured_without_asking`.
- `folders[].access`: `read`, `read_write`. Every folder goes through
  `files.validate_folder` on PUT: home itself, system, app and install
  folders, the PsyNeuLink install, hidden folders, and any folder that is,
  holds or sits inside a Python install or environment (`pyvenv.cfg`,
  `conda-meta`, `site-packages`, `lib/pythonX.Y`) are refused with 400.
- `agent.base_url` belongs to the type it was given for: changing the type
  without giving an address clears it. Changing where messages go (type or
  address) is a raise, named with the real destination.
- `limits.max_tokens` is spending: the tokens the agent's service reports,
  input and output, summed over a session. A turn that reaches it ends with
  `done` reason `limit`. A service that reports no usage isn't limited this way.
- A `PUT` that raises a permission must carry `"confirm_raise": true`, or it
  gets 409 with `detail: {"reason": "confirm_raise", "raised": [...], "message"}`.
  The page asks the user first. Lowering applies at once.
- A `GET` also carries `"available": bool` (the deployment's capability). It
  is not a setting: a `PUT` that includes it is a 400, so the page strips it.
- Every other field is validated; an unknown key is 400.

`GET /api/assistant/key` returns `{"set": bool}`, never the key. `PUT` takes
`{"key": "..."}`. `DELETE` removes it. The key lives in the login Keychain on
the Mac, and only the agent adapter ever reads it.

## Sessions

- `POST /api/assistant/sessions` returns `{"id": "..."}`.
- `POST /api/assistant/sessions/{id}/messages` takes `{"text": "...", "context": {...}}` and returns `{"turn_id": "..."}`. It starts the turn and doesn't wait for it; a second message while one runs is 409.
- `GET /api/assistant/sessions/{id}/events?after=N` returns `{"events": [...], "next": M, "running": bool, "tokens_used": T}`. The page polls this every 500 ms while a turn runs, as a background request in `busyStore`.
- `POST /api/assistant/sessions/{id}/stop` ends the turn at the next step; a reply already in flight is discarded when it comes back.

`context` is what the page can see: `{"file_path", "source", "selection", "errors", "results"}`. The backend drops anything `visibility` doesn't allow before the agent sees it.

Each event has `{"seq", "t", "type", ...}`:

| `type` | Fields |
|---|---|
| `text` | `text` |
| `tool_call` | `tool`, `args` |
| `tool_result` | `tool`, `ok`, `summary` |
| `refused` | `tool`, `reason` (a limit reached has an empty `tool`) |
| `proposal` | `proposal` (below) |
| `error` | `message` |
| `done` | `reason`: `finished`, `stopped`, `limit` |

With the assistant off, every session and proposal route answers 403 with
`detail: {"reason": "off"}`; where the deployment has no assistant, 403 with
`detail: {"reason": "unavailable"}`.

## Proposals

```json
{
  "id": "...",
  "kind": "app_edit | file_write | open_file",
  "summary": "Raise gain on a to 2",
  "state": "pending | accepted | rejected | stale",
  "base_hash": "sha256 of what the agent last read, or null",
  "ops": [{"op": "update_param", "args": {"var_name": "a", "param_name": "gain", "new_value": "2"}}],
  "path": "/Users/me/Models/m.py",
  "before": "...",
  "after": "...",
  "freeform_python": false,
  "warnings": []
}
```

| `kind` | `ops` | `path` | `before` / `after` | `base_hash` |
|---|---|---|---|---|
| `app_edit` | Structured ops, checked (below) | The open model | `after` is a one-line-per-op **description**; `before` is null. Neither is source and the page never applies them as such | sha256 of the `source` the agent read |
| `file_write` | `[]` | The file, inside a `read_write` folder | The file's text before, and the text to write | sha256 of the file's text the agent read; null for a new file |
| `open_file` | `[]` | The file, inside an allowed folder | null | null |

- `POST /api/assistant/proposals/{id}/reject` rejects one.
- `POST /api/assistant/proposals/{id}/accept` takes `{"current_hash": "..."}`:
  for an `app_edit` the sha256 of the source the page holds now; for a
  `file_write` the proposal's `base_hash`. If it differs from `base_hash`, 409
  with `detail: {"reason": "stale", "message"}` and the proposal goes `stale`:
  the agent has to look again, so the user's work is never overwritten.
- **App edits are applied by the page**, op by op, through the same edit
  routes the user's own edits take (`/api/model/update-param`,
  `rename-node`, `add-port`, `remove-port`, `rename-port`), as one History
  entry labelled `Assistant: <summary>`, so one undo reverses it. An op the
  page has no route for is refused, whatever the proposal says.
- **File writes are applied by the backend** on accept, through
  `files.write_model_file`: the path is checked again, the previous version
  is kept under `~/.psyneuview/assistant/previous/`, the write lands by
  rename, and the result is marked unreviewed. A file rule that fails
  answers 409 with `detail: {"reason": <files.PathRefused reason>}` and the
  proposal goes `rejected` (`stale` or `swapped` make it `stale`).
- **Opening is the user's.** Accepting an `open_file` makes the page open the
  file through `/api/model/load`, which meets the execution guard like every
  other open.

### Structured ops: `APP_EDIT_OPS`

Checked by the backend in `propose_app_edit`, before a proposal exists. An
op that isn't listed, an argument that isn't listed, or a value that isn't
plain data is a `refused` event and no proposal.

| `op` | `args` |
|---|---|
| `update_param` | `var_name`, `param_name`, `new_value`; optional `context` (`mechanism`, `function`), `function_class`, `is_default` |
| `rename_node` | `var_name`, `new_name` (a display name: short, printable; written as a quoted literal) |
| `add_port` | `var_name`, `port_kind` (`input`, `output`), `new_name` |
| `remove_port` | `var_name`, `port_kind`, `port_name` |
| `rename_port` | `var_name`, `port_kind`, `old_name`, `new_name` |

- `var_name`, `param_name`, `function_class`: Python identifiers that aren't
  keywords and don't start with `__`.
- `new_value`: a plain literal (`ast.literal_eval`): a number, a string, a
  list, tuple, dict or set of those, `True`, `False`, `None`. No names, no
  calls, no operators but a sign. The backend rebuilds it with `repr`, so a
  comment, a newline or a quote in the text can't reach the file; that
  rebuilt text is what the proposal carries and the page sends.
- Port names: letters, digits, underscores and hyphens, as `file_writer`
  requires.
- The user's own edits through the same routes are unchanged by any of this.

## Tools: `TOOL_ALLOWLIST`

| Tool | Does | Needs |
|---|---|---|
| `read_open_model` | Returns what `context` allows | Always |
| `read_docs` | Searches the app's own `docs/` | Always |
| `propose_app_edit` | Creates an `app_edit` proposal of checked ops | `autonomy` isn't `answer` |
| `list_files` | Lists model files in allowed folders | `visibility.files` |
| `read_file` | Reads a model file's text, **without running it** | `visibility.files` |
| `propose_file_write` | Creates a `file_write` proposal | `visibility.files`, and a `read_write` folder holding the path. A new `.py` must be a PsyNeuLink model by content; a name that would shadow a module (`numpy.py`, `os.py`, `__init__.py`, `sitecustomize.py`, any `_`-prefixed stem) is refused |
| `propose_open_file` | Asks the user to open a file; only the user can accept | `visibility.files` |

Permissions are read again on every call, so a setting lowered mid-turn
applies at once. Limits: `tool_calls` and `minutes` per turn, `max_tokens`
per session.

## `files.py` and `review.py`

```python
def validate_folder(path: str) -> Path: ...  # raises PathRefused; Settings calls it on PUT
def set_folders_provider(fn: Callable[[], list[dict]]) -> None: ...  # settings.py installs its own
def resolve_allowed(path: str, *, write: bool = False) -> Path: ...  # raises PathRefused
def list_model_files() -> list[dict]: ...
def read_model_file(path: str) -> str: ...
def write_model_file(path: str, text: str, *, base_hash: str | None) -> Path: ...  # keeps previous, marks unreviewed
def previous_versions(path: str) -> list[dict]: ...

def mark_unreviewed(path: str, text: str) -> None: ...
def mark_reviewed(path: str, text: str) -> None: ...
def is_runnable(path: str, text: str) -> bool: ...  # False only for unreviewed assistant-written content
def require_runnable(path: str) -> None: ...  # raises UnreviewedAssistantCode
```

`require_runnable` is consulted by every route that executes a model:
`run_in_sandbox` and the in-process importers behind `/model/load`, run,
learn, show-graph, export, the file watcher's reload, autosave's reload,
undo and redo; `/model/load` consults it before the star-import conversion
writes anything. With no state file, or nothing tracked, it costs one lookup.

**Imports.** A model can import other files: a helper beside it, a package
in a subfolder, a folder it puts on `sys.path`. `import_guard.py` puts a
finder first on `sys.meta_path`, in the server process and in the sandbox
worker (which loads it by path and refreshes it from the state file named
in every task, dropping tracked modules from its cache). A module about to
load from a tracked `.py` whose content isn't the approved content fails to
import, and the route answers the same 409 naming that file, so the review
card reviews it. The standard library and site-packages are never vetted,
and with nothing tracked the finder does one check per import and nothing
else. A model beside an unapproved file runs unless it imports it. What
this doesn't cover: a model that runs code by other means
(`exec(open(...).read())`, `runpy`, a subprocess); approving a model means
trusting what it does. A route that would execute unreviewed content answers 409
with `{"detail": <message>, "reason": "assistant_code_unreviewed", "path",
"approve": {...}}` (top level, from the app's exception handler; the page
reads `reason` from either the top level or under `detail`).
`/model/save-source`, `/model/save-project`, `/models/save-as` and
`/model/save-copy` (`py`) write first and then answer that 409, so the page
treats the save as done and offers the review. `/model/preview` refuses
before writing anything: a tracked, unreviewed file can't be previewed
until approved. A save body, a preview, a bundle or an MDF upload that is
unreviewed assistant-written content, exactly or in normalised form (line
endings, trailing whitespace, blank and comment-only lines set aside), is
tracked under its new path and refused the same way, so a copy under a new
name needs the same review as the original. A copy the user edits by hand
is the user's: the normalised index catches accidents and the obvious
trick, not a determined copy, and approval is always of the exact text.

The state is `~/.psyneuview/assistant-review.json`, by real path and
content hash, with a `.bak` beside it. If neither can be read, the state is
unknown and every execution guard refuses (`reason:
"assistant_review_state_unreadable"`) until it is repaired or removed; no
state file at all means nothing is tracked. Tests and a second instance redirect it with
`PSYNEUVIEW_ASSISTANT_REVIEW_FILE`, previous versions with
`PSYNEUVIEW_ASSISTANT_STATE_DIR`, the log with `PSYNEUVIEW_ASSISTANT_LOG`.

### Reviewing assistant-written files

- `POST /api/assistant/review/status` takes `{"path"}` and returns
  `{"path", "tracked", "runnable"}`; for a tracked file also `content` and
  `content_hash` (sha256), so the page shows exactly what an approval covers.
- `POST /api/assistant/review/approve` takes `{"path", "content_hash"}` and
  approves only if the file on disk still hashes to `content_hash`. Otherwise
  409 with `reason: "assistant_code_changed"` and the current `content_hash`,
  and the file stays unreviewed; the page fetches and shows it again. Any
  later change to an approved file makes it unreviewed again.
- These two routes work with the assistant off, so a file written earlier
  can still be reviewed.

## Same site

Every assistant route, the review routes included, carries the one
`same_site` dependency (`same_site.py`): a request whose `Origin` isn't this
server's own site is refused, and in `local` and `mac_app` modes so is a
`Host` that isn't this machine. Both answer 403 with `reason: "not_app_page"`.

## Log

`GET /api/assistant/log` returns every tool call, its arguments, the result,
whether it was allowed, and who approved it (`settings` for a tool the
settings allowed, `user` for an accepted proposal). `DELETE` clears it.
Local only. Prompts, replies and source stay out of problem reports.
