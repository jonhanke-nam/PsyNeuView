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
   above it says when a Claude client is connected.

Both setups contain the **connection token** (see below) and the address of
the running PsyNeuView, so copy them from Settings rather than typing them.

### Claude Code

Settings shows a line like this, with your values filled in. Run it once in
Terminal:

```sh
claude mcp add --transport stdio --scope user \
  --env PSYNEUVIEW_URL=http://127.0.0.1:8000 \
  --env PSYNEUVIEW_MCP_TOKEN=<the token> \
  --env PYTHONPATH=/path/to/PsyNeuView/backend \
  psyneuview -- /path/to/PsyNeuView/backend/.venv/bin/python -m app.mcp_server
```

`--scope user` makes PsyNeuView available in every project. Check it with
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
      "command": "/path/to/PsyNeuView/backend/.venv/bin/python",
      "args": ["-m", "app.mcp_server"],
      "env": {
        "PSYNEUVIEW_URL": "http://127.0.0.1:8000",
        "PSYNEUVIEW_MCP_TOKEN": "<the token>",
        "PYTHONPATH": "/path/to/PsyNeuView/backend"
      }
    }
  }
}
```

Save the file and quit and reopen Claude Desktop. PsyNeuView's tools appear
under the tools button in a new chat.

### If PsyNeuView's address changes

The setup names the port PsyNeuView's backend is running on. If it starts on
another port, copy the setup again (for Claude Code, `claude mcp remove
psyneuview --scope user` first).

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

Every `propose_*` call puts a card in the Assistant tab. Nothing changes until
you accept it there, and anything Claude writes stays unreviewed, so it
doesn't run until you have read and approved it. Model runs stay sandboxed as
set in Settings.

The open model reaches Claude because the page shares it with the backend
whenever it changes (only what **What it can see** allows). So PsyNeuView has
to be open, in the Mac app or a browser, for `read_open_model` to have
anything to read.

## What Claude can't do

- Change any PsyNeuView setting, including turning the assistant on, the
  folders, what it can see or the limits.
- Accept, reject or approve anything. Only you can, in PsyNeuView.
- Read the API key or the connection token.
- Run a model, run a command, or reach the network through PsyNeuView.
- Use any tool that isn't in the list above.

PsyNeuView can't limit what Claude Desktop or Claude Code does by itself. Claude
Code in particular has its own file and command access on your Mac, which is
between you and it. PsyNeuView limits only what is done through its tools.

## Limits

`limits.tool_calls` applies to any stretch of `limits.minutes`: once Claude has
made that many tool calls in that many minutes, the next is refused until the
oldest falls out of the window. `limits.max_tokens` doesn't apply, because
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

The MCP command sends the token only to this machine: it refuses a
`PSYNEUVIEW_URL` that isn't plain `http` to `127.0.0.1`, `::1` or `localhost`.

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
dependency), and never imports PsyNeuLink. It is also installed as
`psyneuview-mcp` when the backend package is installed. Only stdio is offered:
a streamable HTTP endpoint on localhost would need its own protection against
other sites and is a follow-up.

## Trying it without Claude

`backend/tests/test_assistant_mcp.py` drives the server in-process with the
MCP SDK's own client. To try the real command against a running backend:

```python
import anyio
from mcp import Client
from mcp.client.stdio import StdioServerParameters

params = StdioServerParameters(command="<python>", args=["-m", "app.mcp_server"],
                               env={"PSYNEUVIEW_URL": "...", "PSYNEUVIEW_MCP_TOKEN": "...", "PYTHONPATH": "..."})

async def main():
    async with Client(params) as client:
        print([t.name for t in (await client.list_tools()).tools])

anyio.run(main)
```
