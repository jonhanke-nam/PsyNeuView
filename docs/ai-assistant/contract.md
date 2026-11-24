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
| Claude over MCP (#201): connection token, page context, MCP session, routes, the stdio server | `backend/app/services/assistant/mcp_link.py`, `backend/app/api/assistant_mcp_routes.py`, `backend/app/mcp_server.py`; setup in `docs/ai-assistant/mcp.md` |
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
  "keep_log": true,
  "sandbox": {"all_runs": true, "require": true},
  "model_aliases": {"claude-haiku-5": "fast"}
}
```

- `sandbox.all_runs`: every model run is sandboxed while the assistant is
  on, not only while something it wrote is tracked (those always are).
  Turning it off saves directly (#369); the summary shows it.
- `sandbox.require`: turning the assistant on fails with 400
  `{"reason": "sandbox_required", "message"}` where no sandbox can be
  applied. Turning it off saves directly (#369); turning the assistant on
  is still refused with this 400 while it is on and no sandbox can be applied.
- `GET /api/assistant/sandbox`: `{state: on | unavailable | available |
  off_unavailable, available, wanted, why, mechanism, platform,
  landlock_abi, enforced, not_enforced, reason, forced, all_runs, require}`.
  `unavailable` means runs are wanted sandboxed and are NOT. The same
  summary is in `/api/settings/info` as `os_sandbox`.
- A run that must be sandboxed (the assistant on, or anything it wrote
  tracked) where no sandbox can be applied answers 409
  `{"reason": "sandbox_required", "detail"}` and nothing runs, unless
  `sandbox.require` is off or the server was started with
  `PSYNEUVIEW_OS_SANDBOX_ALLOW_UNSANDBOXED=1`. A sandboxed run may write in
  the model's own folder (not code or the assistant's files); when that
  folder can't be opened, the model's `notices` say why.

- `agent.type`: `none`, `anthropic`, `openai_compatible`, `claude_mcp`.
  `base_url` must be `https`, or `http` to this machine only. With
  `claude_mcp` (#201) no agent is called from PsyNeuView: Claude Desktop or
  Claude Code connects over MCP (below, and `mcp.md`); `model` and
  `base_url` are stored empty, and choosing it while on asks first, like
  any new destination.
- `autonomy`: `answer`, `suggest`, `app_edits`.
- `saving`: `always_ask`, `structured_without_asking`.
- `folders[].access`: `read`, `read_write`. Every folder goes through
  `files.validate_folder` on PUT: home itself, system, app and install
  folders, the PsyNeuLink install, hidden folders, and any folder that is,
  holds or sits inside a Python install or environment (`pyvenv.cfg`,
  `conda-meta`, `site-packages`, `lib/pythonX.Y`) are refused with 400.
- `agent.base_url` belongs to the type it was given for: changing the type
  without giving an address clears it. Changing where messages go (type or
  address) while the assistant is on needs consent, named with the real
  destination and the old one (#369). An OpenAI-compatible type with no
  address yet sends nothing, so it saves directly; giving the address asks.
- `limits.max_tokens` is spending: the tokens the agent's service reports,
  input and output, summed over a session. A turn that reaches it ends with
  `done` reason `limit`. A service that reports no usage isn't limited this way.
- **One clear consent (#369).** A `PUT` must carry `"confirm_raise": true`
  only to turn the assistant on (`enabled` false to true), or to change
  where messages go while it is on. Without it, it saves nothing and answers
  200 with `{"needs_confirmation": true, "reason": "confirm_raise",
  "raised": [...], "message"}` (#367: not an error, so the browser console
  stays clean). Turning on, `raised` is `["turning the assistant on",
  "sending messages to <address>"]`. The page shows the consent first: what
  is shared, with whom (the service's host, and that PsyNeuView can't limit
  what that service does with it), what it can do, and the folders, with
  Turn on / Cancel. Every other change, widening or lowering (folders,
  autonomy, saving, visibility, limits, the sandbox options, choosing an
  agent while off), saves directly, and Settings always shows a short
  summary of what is shared and with whom. The decision, and why it is
  safe, is in [`threat-model.md`](threat-model.md) section 4.4.
- A `GET` also carries `"available": bool` (the deployment's capability). It
  is not a setting: a `PUT` that includes it is a 400, so the page strips it.
- Every other field is validated; an unknown key is 400.

`GET /api/assistant/key` returns `{"set": bool}`, never the key. `PUT` takes
`{"key": "..."}`. `DELETE` removes it. The key lives in the login Keychain on
the Mac, and only the agent adapter ever reads it.

`POST /api/assistant/test-connection` (#368) sends one minimal request to the
saved agent with the saved key and answers 200 with `{"ok": bool, "agent",
"model", "ms", "message"}`. Anthropic gets a Messages call with `max_tokens`
1, the text "ping" and no tools; an OpenAI-compatible server gets the same as
a chat completion. It goes through the adapter's `_post_json`, so a redirect
is refused, and it waits at most 15 seconds (`TEST_TIMEOUT_SECONDS`).
`message` is plain English and never contains the key: no agent chosen, no
key saved, "The key was refused (HTTP 401)" (or 403), "The model name isn't
recognised: X" (404, or a 400 naming the model), "Rate limited or out of
credit (HTTP 429)", "Couldn't reach <host>" (no network, refused, timed out),
or "Connected to Anthropic, model X, in N ms". It works with the assistant
off, since you test before turning it on, but sends nothing until an agent is
chosen: saving the agent type is where sending to that address is confirmed.
Like every assistant route it is same-site only, and 403 `unavailable` where
the deployment has no assistant.

`GET /api/assistant/models` (#370) asks the saved agent's service which
models it offers, with the saved key: `GET <base>/v1/models` on Anthropic's
API (`?limit=1000`) or the OpenAI-compatible server (Ollama answers the same
path; its own `{"models": [{"name"}]}` shape is read too). It goes only to
the chosen service, through the same request handling as the agent calls
(redirects refused, a 15-second wait, the key never logged or echoed), and
answers 200 with `{"ok": bool, "agent", "models": [{"id", "display_name"}],
"default", "message"}`. `default` is what Settings preselects when no model
is saved: `claude-opus-5-5` for Anthropic when it is listed, else the
newest; `""` (the server's own) for an OpenAI-compatible server. Errors are
plain English, as for Test connection: no agent, no key, the key refused,
rate limited, couldn't reach the host, no model list (404). Settings keeps
the saved choice and the last list on an error, and flags a saved model the
service no longer lists as "no longer offered by the service" without
changing it. Typing an id is the developer's escape, in Developer.

`model_aliases` in the settings is `{model id: short name}` (#370), at
most 200 entries of up to 40 characters; an empty name removes one. The
name is shown in the model drop-down and the Assistant tab; the real id is
what is sent. Changing it saves directly.

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
| `check_proposal` | `{id}` in, `{id, state}` out: whether one of this session's own proposals is `pending`, `accepted`, `rejected` or `stale` (couldn't apply: the model changed). Reads only; never changes a proposal; another session's id is refused as unknown | Always |

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
card reviews it; so does a file loaded by path (`spec_from_file_location`
+ `exec_module`, `SourceFileLoader.load_module`), through a wrapper on
`SourceFileLoader.get_code`. The worker also checks the model's own path
itself, whatever started it, finding the state file from the payload or
the default path. The standard library, site-packages and the active
PsyNeuLink checkout are never vetted or purged (a tracked path is checked
first, wherever it sits), and with nothing tracked the finder does one
check per import and nothing else. A model beside an unapproved file runs
unless it imports it. Every layer, and the review lookups here, match a
path to a tracked file by its real path with accents composed and case
folded, or by the file it is on disk, so a case variant, a decomposed
accent or a hard link names the same entry. An audit hook in the worker
(and, on the loading thread and threads it starts, in the server's
in-process converter) refuses a path that leads to an existing tracked,
unapproved file when model code reads it, compiles or runs it under its
name, renames, moves, links or symlinks it, or names it in a new process
(its command, an interpreter's program text past wrappers such as `env`,
`os.system` text, the environment, or a shell pattern anchored in its
folder); a path that leads nowhere or to another file is left alone. This
covers `exec(open(...).read())`, `runpy.run_path`, `python helper.py` and
`sh -c 'cat helper.py'` (#187). While anything is tracked, each task runs
in a child forked from a parent that has run no model code, so nothing one
model does to its process's memory reaches the next, and the model's own
Python code in the worker can't change the review record, the guard's
files or the code later tasks import (a process it starts can). The guard stops
assistant-written code running by accident or through ordinary paths; it
is not a sandbox against model code that deliberately acts as the user.
**In-process protection covers memory only.** Behind it is the
**operating-system sandbox** (#311, `os-sandbox.md`): while anything is
tracked, and for every run while the assistant is on (`sandbox.all_runs`),
each task's process applies a policy before any model code runs, so the
kernel refuses reading unapproved files and secrets, writing outside the
task's folder and the declared output folders (never the review record,
the app, PsyNeuLink, the settings file or the Python install), starting
anything but Python and Graphviz, and the network, in that process and
every process it starts. Converting a model runs it in a sandboxed process
too. Where no sandbox can be applied, `GET /api/assistant/sandbox` and
About say so, and with `sandbox.require` (the default) the assistant
doesn't turn on. The threat model's section 7 lists exactly what isn't covered. Approving a model means trusting what
it does. Every place code is started or executed in `backend/app` is
listed in the threat model with its guard, and a test fails if a new one
appears unlisted. A route that would execute unreviewed content answers 409
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

## Claude over MCP (#201)

With `agent.type: claude_mcp`, the agent is Claude Desktop or Claude Code,
signed in with the user's subscription. It launches `psyneuview-mcp` (the
console script `[project.scripts]` declares; `python -m app.mcp_server` is
the same command) over stdio; that command calls the backend over HTTP on
`127.0.0.1` with the connection token, and forwards the backend's tool list
and tool results unchanged. Setup and limits for users: `mcp.md`.

**Finding the backend.** The command finds the running backend itself on
every request, so the setup names no address (`mcp_discovery.py`):

- The backend writes a discovery file, `{pid, port, host, version,
  started}`, made `0600` (never widened, whatever the umask) and moved into
  place whole. It writes it at start when `agent.type` is `claude_mcp`
  (port from uvicorn's `--port`, `--port=` or `UVICORN_PORT`), and the
  page's `setup` and (while active) `status` routes rewrite it with the port
  the request really came in on. It removes it at shutdown if it still
  names this process.
- Where: `PSYNEUVIEW_MCP_DISCOVERY_FILE`; else `mcp-backend.json` beside a
  redirected preferences file (`PSYNEUVIEW_CONFIG_FILE`), and the setup then
  names it in `PSYNEUVIEW_MCP_DISCOVERY_FILE`; else
  `~/.psyneuview/mcp-backend.json`.
- One holder: a backend doesn't overwrite a file naming another live
  process; it takes over a file whose process has stopped.
- The command refuses a file that isn't a plain file owned by the user with
  no group or other permission bits, names a host other than loopback, or a
  pid that isn't alive and the user's; each refusal is a sentence the user
  can act on ("PsyNeuView isn't running…").
- `PSYNEUVIEW_URL` overrides the lookup; it must still be plain `http` to
  loopback.

**How the setup starts the command** (`mcp_link.command`): the Mac app's
launcher when the backend has `PSYNEUVIEW_MCP_LAUNCHER` naming an executable
file; else `psyneuview-mcp` beside the backend's Python; else `python -m
app.mcp_server`. In the last two the setup also sets `PYTHONPATH` to this
backend, so a checkout that borrows another's environment runs its own code.

**The page's routes**, `same_site` like every other assistant route:

| Route | Does |
|---|---|
| `GET /api/assistant/mcp/setup` | `{url, command, args, env_names, discovery_file, claude_code, claude_desktop, token}`: the `claude mcp add` line and the `claude_desktop_config.json` snippet, with the token, made on first use, and no address (`url` is this backend's, for information only). Writes the discovery file. Works with the assistant off, outside `container` and `hosted` |
| `POST /api/assistant/mcp/token` | A new token, same shape; any client set up with the old one gets 401 from then on |
| `GET /api/assistant/mcp/status` | `{connected, last_seen, seconds_ago, client, active, session_id, tool_calls: {used, limit, minutes}}`. `connected`: heard from in the last 90 s (the command says hello every 30 s). `client`: the connected program's own name and version, as it gave them to the MCP command. `tool_calls.used`: calls in the current `limits.minutes` window, the count the limit applies to. `session_id`: the MCP session, while `active` (on, with `claude_mcp` chosen); while active it also rewrites the discovery file if needed |
| `PUT /api/assistant/mcp/context` | `{context}`, as with a message; filtered by `visibility` on arrival. Needs the assistant on |

**The MCP command's routes**, `/api/assistant/mcp-client/...`, not
`same_site` but checked by `mcp_client` on every request, in this order:

1. The peer address is `127.0.0.1` or `::1`, and `Host` names this machine,
   else 403 `not_local`.
2. No `Origin` header, else 403 `not_mcp_client` (every browser request has
   one; the command never sends one).
3. `Authorization: Bearer <token>` matches the stored token (constant-time),
   else 401 `bad_token` with `WWW-Authenticate: Bearer`. No stored token
   matches nothing.
4. The assistant is available (403 `unavailable`), on (403 `off`), and
   `agent.type` is `claude_mcp` (403 `not_chosen`).

| Route | Does |
|---|---|
| `POST /api/assistant/mcp-client/hello` | Heartbeat; `{ok, session_id}` |
| `GET /api/assistant/mcp-client/tools` | `{tools: TOOL_DEFINITIONS, instructions}` |
| `POST /api/assistant/mcp-client/tools/{name}` | `{arguments}` in, `{ok, content}` out: the same text the built-in agent gets (`[untrusted data …]` + JSON, or `Refused: …`, or `Error: …`) |

There is no route in that group for settings, the key, the token, proposals,
reviews or models. A tool call runs through `Session.call_tool`, the
built-in agent's own dispatcher, in the one pinned MCP session (never
dropped to make room): the allowlist, the per-call settings and checks, the
`tool_call` event (with `via: "mcp"`), `refused` and `tool_result` events and
the log line are the same. `read_open_model` and `propose_app_edit` read the
context the page last shared, filtered again by `visibility` as it is then;
with no page context yet they are refused, saying PsyNeuView isn't open.
`limits.tool_calls` applies to any `limits.minutes`-long window;
`limits.max_tokens` doesn't apply (PsyNeuView never sees the tokens).

The token is kept like the API key, in the login Keychain (service
"PsyNeuView AI assistant", account `mcp-connection-token`), or in memory when
`PSYNEUVIEW_ASSISTANT_KEY_STORE=memory`; it is cached in the backend process
and never logged. The page shows it only in the setup text.

The Assistant tab, with `claude_mcp`, has no text box: it says to use Claude
Desktop or Claude Code, polls the status every 1.5 s and the MCP session's
events, shares the context whenever the open model, its source or the
selection changes, and shows proposals with Accept and Reject as usual.

## Same site

Every assistant route, the review routes included, except the MCP command's
token-checked group above, carries the one `same_site` dependency
(`same_site.py`): a request whose `Origin` isn't this server's own site is
refused, and in `local` and `mac_app` modes so is a
`Host` that isn't this machine. Both answer 403 with `reason: "not_app_page"`.

## Log

`GET /api/assistant/log` returns every tool call, its arguments, the result,
whether it was allowed, and who approved it (`settings` for a tool the
settings allowed, `user` for an accepted proposal). `DELETE` clears it.
Local only. Prompts, replies and source stay out of problem reports.
