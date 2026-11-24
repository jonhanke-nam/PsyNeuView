# AI assistant: Claude through your subscription, over MCP (#201)

A Claude subscription signs in to Claude Desktop and Claude Code, not to
other programs. So PsyNeuView doesn't call Claude itself here. Instead it
offers an **MCP server**, and Claude Desktop or Claude Code, signed in with
your subscription, connects to it and uses PsyNeuView's assistant tools.
PsyNeuView keeps no API key for this, and the subscription pays for Claude's
use.

You talk to Claude in Claude Desktop or Claude Code. Its changes come to
PsyNeuView's Assistant tab as proposals, which you accept or reject there,
exactly like the built-in assistant's.

## Setting it up

1. In PsyNeuView, open **Settings ▸ AI assistant**.
2. Under **Which agent**, choose **Claude (your subscription, via Claude
   Desktop or Claude Code)**.
3. Turn on **Use an AI assistant** if it isn't on. Claude can connect only
   while it is on and this agent is chosen.
4. Copy the setup for the Claude program you use (below). The status line
   above it says when a Claude client is connected, which program it is,
   and how many tool calls it has made in the current limit window.

Both setups contain the **connection token** (see below), so copy them from
Settings rather than typing them. They name no address: the command finds
the running PsyNeuView by itself (see "Finding PsyNeuView" below).

### Claude Code

Settings shows a line like this, with your values filled in. Run it once in
Terminal:

```sh
claude mcp add psyneuview --transport stdio --scope user \
  -e PSYNEUVIEW_MCP_TOKEN=<the token> \
  -e PYTHONPATH=/path/to/PsyNeuView/backend \
  -- /path/to/PsyNeuView/backend/.venv/bin/psyneuview-mcp
```

(Where `psyneuview-mcp` isn't installed, the line ends `.../python -m
app.mcp_server` instead; the two are the same command.)

The name `psyneuview` comes first: `-e` takes several values, so a name after it is read as another variable. `--scope user` makes PsyNeuView available in every project. Check it with
`claude mcp list` (it should say `psyneuview ... ✓ Connected`), or `/mcp`
inside Claude Code. Remove it with `claude mcp remove psyneuview --scope user`.

### Claude Desktop

In Claude Desktop, open **Settings ▸ Developer ▸ Edit Config**. That opens
`~/Library/Application Support/Claude/claude_desktop_config.json`. Add the
snippet from Settings (if the file already has an `"mcpServers"` object,
add only the `"psyneuview"` entry inside it):

```json
{
  "mcpServers": {
    "psyneuview": {
      "command": "/path/to/PsyNeuView/backend/.venv/bin/psyneuview-mcp",
      "args": [],
      "env": {
        "PSYNEUVIEW_MCP_TOKEN": "<the token>",
        "PYTHONPATH": "/path/to/PsyNeuView/backend"
      }
    }
  }
}
```

Save the file and quit and reopen Claude Desktop. PsyNeuView's tools appear
under the tools button in a new chat.

### Finding PsyNeuView

The Mac app may start PsyNeuView's backend on a different port each time, so
the setup names no address. Instead, while Claude over MCP is the chosen
agent, the backend writes a small **discovery file** with its port and
process id, `~/.psyneuview/mcp-backend.json`, readable by you only. The
command reads it on every request, so it keeps working after PsyNeuView
restarts on another port, with no need to copy the setup again.

If PsyNeuView isn't running, Claude sees a plain reason, such as
"PsyNeuView isn't running (the last one, process 12345, has stopped). Start
PsyNeuView and try again."

The command refuses a discovery file that another account could read or
write, a link instead of a file, or one naming another machine.

- **`PSYNEUVIEW_URL`** (`http://127.0.0.1:<port>`) in the setup overrides the
  lookup, for a backend you want to pin.
- **`PSYNEUVIEW_MCP_DISCOVERY_FILE`** names another discovery file. When a
  backend runs with its preferences redirected (`PSYNEUVIEW_CONFIG_FILE`: the
  test harness, a trial run), it writes `mcp-backend.json` beside that file
  instead, and the setup it shows sets this variable, so a test backend never
  takes over your real one.
- With several backends running, the first one keeps the file; another takes
  it over only when that one stops.

## What Claude can do

The same tools as the built-in assistant, from the same code
(`TOOL_ALLOWLIST` in `backend/app/services/assistant/tools.py`), with the
same checks on every call against the settings as they are at that moment:

| Tool | Does |
|---|---|
| `read_open_model` | The open model's file path and code, the selection and errors, as far as **What it can see** allows |
| `read_docs` | Searches PsyNeuView's own documentation |
| `propose_app_edit` | Proposes a structured edit to the open model |
| `list_files`, `read_file` | Lists and reads model files in the allowed folders (never runs them) |
| `propose_file_write` | Proposes writing a model file in a read-and-write folder |
| `propose_open_file` | Asks you to open a model file |
| `check_proposal` | Whether one of its proposals is still pending, or you accepted or rejected it (or it was stale: the model had changed), so Claude can follow up. Read-only |

Every `propose_*` call puts a card in the Assistant tab. Nothing changes until
you accept it there, and anything Claude writes stays unreviewed, so it
doesn't run until you have read and approved it. Model runs stay sandboxed as
set in Settings.

The open model reaches Claude because the page shares it with the backend
whenever it changes (only what **What it can see** allows). So PsyNeuView has
to be open, in the Mac app or a browser, for `read_open_model` to have
anything to read.

## What Claude can't do

Through its PsyNeuView tools, Claude can't:

- Change any PsyNeuView setting, including turning the assistant on, the
  folders, what it can see or the limits.
- Accept, reject or approve anything. Only you can, in PsyNeuView.
- Read the API key or the connection token.
- Run a model, run a command, or reach the network through PsyNeuView.
- Use any tool that isn't in the list above.

**And not around them, over HTTP (#381).** Claude Code has its own shell, and
Claude Desktop can have tools of its own, so either can send requests straight
to PsyNeuView's server, as `curl` would. Those requests get nowhere: every
route that changes settings, gives consent, reads the token, accepts, rejects
or approves needs the page secret, which PsyNeuView gives only to its own page
(the Mac app hands it to its window; a browser gets it from the link the server
printed), and never serves over HTTP. A change also has to name its site, which
only a browser does. See [`threat-model.md`](threat-model.md), "The page secret".

**What PsyNeuView can't stop.** A program running as you can, in principle,
find the secret another way: by reading the server's memory, or, when you run
PsyNeuView from a terminal or a script instead of the Mac app, by reading the
line the server printed with the link (scrollback or a log file). Claude Code's
shell runs as you. So, while Claude is connected, give Claude Code these
permission rules, in `~/.claude/settings.json` (or the project's
`.claude/settings.json`). Change `8353` to PsyNeuView's port (the number after the colon in
the address PsyNeuView runs at) and the log path to wherever your server's
output goes; the Mac app prints no link, so its users need only the first four:

```json
{
  "permissions": {
    "deny": [
      "Bash(*127.0.0.1:8353*)",
      "Bash(*localhost:8353*)",
      "WebFetch(domain:127.0.0.1)",
      "WebFetch(domain:localhost)",
      "Read(~/psyneuview-ai-trial/backend.log)",
      "Bash(*psyneuview-ai-trial/backend.log*)"
    ]
  }
}
```

The `WebFetch` rules block every port on that host (they match host names
only). The `Bash` rules match the command's text, so they stop the plain
attempts (`curl http://127.0.0.1:8353/…`, `cat …/backend.log`), and Claude Code
asks no question for them: they are refused. Claude Code's own documentation
says such text patterns can be got around (another program, a variable,
another spelling of the address). They aren't the protection; the page secret
is. They close the obvious paths and make an attempt show up in the
conversation. For a hard block on the shell's network access, run Claude
Code's shell in its sandbox: by default a sandboxed command can't connect to a
server running on your Mac outside the sandbox (leave
`sandbox.network.allowLocalBinding` off).

PsyNeuView can't limit what Claude Desktop or Claude Code does otherwise.
Claude Code in particular has its own file and command access on your Mac,
which is between you and it. PsyNeuView limits only what is done through its
tools and its server.

## Limits

`limits.tool_calls` applies to any stretch of `limits.minutes`: once Claude has
made that many tool calls in that many minutes, the next is refused until the
oldest falls out of the window. Settings shows the count under the status
line, for example "4 tool calls in the last 10 minutes, of 25 allowed." `limits.max_tokens` doesn't apply, because
PsyNeuView never sees Claude's tokens; your subscription's own limits do.

## The connection token

The MCP command has to prove it is your own connection. PsyNeuView makes a
random token the first time you open the setup, keeps it in your login
Keychain (as "PsyNeuView AI assistant", account `mcp-connection-token`,
beside the API key), and puts it in the setup text. The command sends it with
every request; without the right token PsyNeuView answers 401.

The token also ends up in Claude's own configuration (`~/.claude.json` for
Claude Code, `claude_desktop_config.json` for Claude Desktop), so treat it like
a password. **Make a new token** in Settings replaces it at once: anything set
up with the old one is refused from then on, and you copy the setup again.

PsyNeuView accepts MCP calls only:

- from this Mac (the connection comes from `127.0.0.1` or `::1`, and names
  this machine);
- with no web page behind them (a request carrying an `Origin` header, which
  every browser sends, is refused, so no web page can use the token);
- with the right token;
- while the assistant is on and Claude over MCP is the chosen agent.

The token is shown only in Settings: the setup route that returns it needs the
page secret (#381), so no other program can fetch it from PsyNeuView. A
program running as you can still read it where Claude keeps it (Claude's
configuration file) or from the Keychain.

The MCP command sends the token only to this machine: it refuses an address,
from `PSYNEUVIEW_URL` or the discovery file, that isn't plain `http` to
`127.0.0.1`, `::1` or `localhost`.

## How it fits together

```
Claude Desktop / Claude Code  (signed in with your subscription)
        │  stdio (MCP)
        ▼
python -m app.mcp_server       backend/app/mcp_server.py: a thin bridge, no model or file access
        │  HTTP to 127.0.0.1, Authorization: Bearer <token>
        ▼
/api/assistant/mcp-client/*    backend/app/api/assistant_mcp_routes.py (token checked)
        │
        ▼
Session.call_tool              the built-in agent's own dispatcher, allowlist, checks, events and log
        │
        ▼
Assistant tab                  polls the MCP session; you accept or reject
```

The command uses only the standard library and the MCP SDK (`mcp`, a backend
dependency), and never imports PsyNeuLink. Only stdio is offered: a
streamable HTTP endpoint on localhost would need its own protection against
other sites and is a follow-up.

## The `psyneuview-mcp` command, and what the Mac app needs

`backend/pyproject.toml` declares the console script:

```toml
[project.scripts]
psyneuview-mcp = "app.mcp_server:main"
```

so `pip install -e backend` (or `uv pip install -e backend`) puts
`psyneuview-mcp` in the environment's `bin/`, beside its `python`.
`python -m app.mcp_server` is the same command and stays the fallback. The
setup text picks, in order:

1. the launcher named by `PSYNEUVIEW_MCP_LAUNCHER` in the backend's
   environment, if it is an executable file (no `PYTHONPATH` needed);
2. `psyneuview-mcp` beside the backend's Python, with `PYTHONPATH` set to the
   backend so it runs this checkout's code;
3. `python -m app.mcp_server`, likewise.

The Mac app already runs `pip install -e .` in the install's `backend/`, so
`<install>/backend/.venv/bin/psyneuview-mcp` exists. But that path names the
installed version (`.../PsyNeuView/psyneuview-0.6.16/backend/...`), and an
update moves it, which would break the setup pasted into Claude. So that the
setup survives updates, the Mac app needs to (a change for the Mac app repo,
not made here):

1. After each install or update, once the backend's `pip install -e .` has
   finished, make a link at a path that doesn't change, for example
   `~/Library/Application Support/PsyNeuView/bin/psyneuview-mcp`, pointing to
   the current install's `backend/.venv/bin/psyneuview-mcp`. Replace it
   atomically (make the new link beside it, then rename it over the old), and
   make the `bin` folder writable by the user only.
2. Start the backend with `PSYNEUVIEW_MCP_LAUNCHER` set to that path, beside
   the other variables it passes (`backendOverrides`). The setup text then
   names the stable path, and no `PYTHONPATH`.
3. The test app keeps its own link (its own folder), as it keeps its own
   preferences, so it never takes over the real app's setup.

Nothing else is needed: the command finds the backend's port through the
discovery file, and the token is in the login Keychain.

## Trying it without Claude

`backend/tests/test_assistant_mcp.py` drives the server in-process with the
MCP SDK's own client. To try the real command against a running backend:

```python
import anyio
from mcp import Client
from mcp.client.stdio import StdioServerParameters

params = StdioServerParameters(command="<python>", args=["-m", "app.mcp_server"],
                               env={"PSYNEUVIEW_MCP_TOKEN": "...", "PYTHONPATH": "..."})

async def main():
    async with Client(params) as client:
        print([t.name for t in (await client.list_tools()).tools])

anyio.run(main)
```
