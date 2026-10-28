# Settings, and the Mac app as a thin wrapper

PsyNeuView runs in a browser and inside the Mac app (PsyNeuView-MacApp). Each
grew its own Settings, and two controls for the same thing appeared: the
PsyNeuLink source and developer mode could be changed in both, and the two had
come to show different things. These rules keep that from happening again
([#1279](https://github.com/jonhanke-nam/PsyNeuView/issues/1279),
[PsyNeuView-MacApp#200](https://github.com/jonhanke-nam/PsyNeuView-MacApp/issues/200)).

## The Mac app is a thin wrapper around the React app

1. **Any UI that can live in React lives in React,** so it works the same in a
   browser and in the Mac app.
2. **The Mac app contributes only what React can't do:** native file dialogs,
   starting and stopping the server, installs and updates, launch at login. It
   does that through **bridges** — `pnvFile` (`utils/fileBridge.ts`) and
   `pnvSettings` (`utils/macAppSettings.ts`) — and **menu items that route into
   the React UI** (the app's Settings… ⌘, sends the page `pnv:open-settings`).
3. **React detects the bridge** and shows Mac-only parts only when it is
   present. In a browser they are absent and nothing else differs.
4. **Native windows are exceptions** for what must work before React exists or
   when it can't run: the Setup Wizard, the starting window with its progress
   checklist, Logs, and About. The Mac app's `NativeWindowPolicyTests` lists
   them with their reasons; any other native window fails its CI until it is
   added there with an equally concrete reason.

## Settings

1. **One Settings surface:** PsyNeuView's Settings. The ⚙ button (next to the
   app name), **Layout ▸ Settings…** and, in the Mac app, **Settings… ⌘,** all
   open it. The Mac app has no settings UI of its own.
2. **One control per setting.** A setting has exactly one home and one
   control. A second way to change it is a bug. The one allowed exception is
   a *simple view* of a Developer setting, which edits the same value
   through the same mechanism ([Settings etiquette](settings-etiquette.md), §8).
3. **Mac-only settings** — which PsyNeuView install runs, auto-restart, launch
   at login, and how problem reports are sent — appear in the same Settings,
   each in the section it belongs to, shown only inside the app, and are read
   and written through the `pnvSettings` bridge. Problem reports is a whole
   section of the app's, listed only inside it.
4. **One source of truth per value:** the side that acts on a setting owns it;
   the other side asks rather than keeping its own copy. The PsyNeuLink source
   is the backend's (#132). Developer mode's one control is in Settings; inside
   the Mac app the app keeps its value, because the page's own storage starts
   empty on every launch there (a new port each time is a new origin) and the
   app acts on it before the page loads.

### The layout: a sidebar of sections

Settings is a wider window with a sidebar on the left; one section shows at a
time ([#1290](https://github.com/jonhanke-nam/PsyNeuView/issues/1290)). A new
user meets the simplest, most useful things first; advanced and developer
settings come last, where nobody lands by accident. Settings reopens
on the section shown last (remembered per browser; About the first time), and
anything in the app can open it at a section with `openSettings("developer")`
(`frontend/src/components/common/settings/sections.ts`). The Mac app's ⌘,
opens it on the last section.

| Section | What's there | Mac app only |
|---|---|---|
| **About** | versions, one line each: PsyNeuView; **Running from** (#1356) — "The version included with the Mac app", "Your checkout at ~/…", or "A browser session served from …" (the one path About shows, since which folder it is *is* the answer), and for a checkout its branch and commit, files changed, how far behind `origin/devel` (and the branch it tracks) it is **as last fetched** (no network on open), how to update, and whether it moved since the server started, with **Check now** (a fetch with a 30-second timeout; nothing is pulled); the **Server commit** and **Page built from**, and an amber note first when the two disagree ("This page is older than the server; reload", with Reload); PsyNeuLink with where it comes from ("PsyNeuLink 0.19.1.0, from PrincetonUniversity/PsyNeuLink @ devel"), ModECI MDF, GitHub sign-in; links; in a browser, **Download diagnostics** — the versions, settings, the open model's name and where it came from, and what happened since the page opened, as one JSON file for a problem report ([Diagnostics](#diagnostics-window__pnvdiagnostics), #1287) | the Mac app's Report a Problem includes the same, so the button is not shown there |
| **General** | **PsyNeuLink version**: Latest development (recommended, the default; with when the branch last moved) or Official release, picked from every PyPI release with its date (incompatible ones greyed, old ones marked "no run stepping", kept ones marked) — the simple view of Developer's full form, same setting, same install request; "Custom — chosen in Developer" with the source and path when it is anything else; under it, how current it is ("3 commits behind · last checked 10:42", "✓ Up to date", "a newer release is available"), **Check now**, and **Keep Latest development up to date automatically** (on by default; an update installs at the next start, #1304); **Model files**: **Autosave**, off by default, and when on *after N seconds without activity* (10; 2–600) (#1347, [What you can edit](what-you-can-edit.md#autosave)), and where new models' sidecar files go | **Mac app**: restart PsyNeuView if it crashes, open PsyNeuView when you log in |
| **Appearance** (#1301) | how the app looks and feels, remembered per browser: **Pointer in the graph view** — Arrow (default), our own image whose tip is the exact point that clicks, over the canvas, nodes and edges, with the grabbing hand only while a drag is in progress — or Hand, Crosshair or Circle (#40), our own images too; a bend handle or attachment dot shows the arrow (or the crosshair or circle) rather than the hand, so the exact point is clear; **Pointer size** — Small, Medium (default), Large, Extra large, covering the arrow, the hand, the crosshair, the circle and the grabbing hand while dragging (#40), with a preview. Window zoom doesn't scale cursors; this is the one control for the size; **Automatic layout** — how models are arranged when they have no layout of your own: Like show_graph (default: where PsyNeuLink's show_graph() puts each node, with its edges, #24), Layered, Radial or Force (#19); choosing Like show_graph also switches edges to Smooth, the default edge style (#41); the toolbar's layout menu switches the open model; **Graph legend** — how the legend opens: Starts collapsed (default) or Starts expanded (#7); the legend's own Show/Hide folds it for the open model; **Components panel** — how the panel opens: Starts open (the word list, default) or Starts as the icon strip (#113); the panel's own ◀/▶ switches it for the session only. *Not here:* **Show ports** (#112) is the one switch in the graph toolbar's **Advanced Graph View Options** (#123) — off by default, it shows the port dots on the graph and the Ports section in Components, and is remembered per browser; Settings has no second control for it (listed under `elsewhere` in the inventory) | — |
| **Tutorials and Voice** (#1404, #1407) | **Voice**: the **Narration voice** that reads walkthrough captions — Automatic (the best English voice installed) or any installed English voice, with ▶ Play sample and how to download a free Premium voice — and the **Speaking rate**; **Tutorials**: the **PsyNeuView First Steps reminder** (offer again, remind in the Tutorials menu, or don't) and **Hide the Cognitive Neuroscience Course** (off by default; leaves the course's section out of the Tutorials menu, while a course walkthrough opened by link still runs, #136). Narration on/off stays on the walkthrough bar | — |
| **Open menu** | only the sections' order and which catalogs under development show; the ones under development always stay below the everyday sections, and carry the Developer badge when developer mode is what shows them | — |
| **Folders** (#1295) | everything you can open and where it lives, in the Open menu's order, one row each with its path, whose it is (yours to edit / managed for you) and Show in Finder: **My Project Folder** (Change…, **Move…**, and the one-time offer to move out of a hidden legacy folder), **your catalogs** (add, rename, remove), the PsyNeuLink Library and Examples ("from the PsyNeuLink you've selected", with a link to Developer), the Reference and Demo models included with PsyNeuView; a note on where app data stays | Show in Finder (Copy path in a browser) |
| **Keyboard shortcuts** | every shortcut, rebindable | — |
| **Problem reports** (Mac app only: listed only when the bridge is present) | — | how Report a Problem sends a report: Send reports with, Send to |
| **Developer (advanced)** (always listed, last) | **the developer-mode switch, first**; which PsyNeuLink is installed: a "✓ In use now" line and one **Switch to** dropdown — *Another local checkout…* (Path with a Finder **Choose…** in the Mac app) and *Another GitHub repo or branch…* first, then the known sources in groups that fold with their counts: your checkouts, one per GitHub repo (rows say the branch alone), the official releases on PyPI with dates (the newest five, then *Show older*), only the group holding the one in use starting open — with full names, the one in use marked, what the switch will change said before Apply & restart, a button that appears only for a valid choice that differs from what is installed (#1303, #1331, #1334), and **Manage known sources** (folded: Rename, and Remove for all but the one in use); **where PsyNeuView and PsyNeuLink are installed** (path, whose it is, Show in Finder); **PsyNeuLink details** (repo, branch, commit, path, version, branch freshness, debugging support); the **managed PsyNeuLink copies** and **kept official releases** with size, last used and Remove, and the known checkouts (folded); **Keep your checkouts current** (folded): per checkout, Check for upstream changes and Pull on launch, both off by default, with the remote branch, behind or up to date, last checked and the last launch's pull (#1304) | which PsyNeuView runs: included with the app, or a checkout (folded) |

Developer follows Problem reports in the list rather than being pinned to
the bottom, so a short window still shows it; a remembered or requested
section that this build doesn't list (Problem reports in a browser, an id from
an older build) falls back to About; "(advanced)" in its name says
what the purple badge says elsewhere. Within a section, groups fold, with
their contents indented under the heading; a rarely changed group starts
folded and shows a one-line summary of its current state. A path is shown on
its own line in a "Full path" box, the home folder as `~`, the full path as
the tooltip. Every dialog closes the same ways:
the × in its fixed header, Escape, and a click outside
([#1288](https://github.com/jonhanke-nam/PsyNeuView/issues/1288),
[#1289](https://github.com/jonhanke-nam/PsyNeuView/issues/1289)). How a new
setting is placed, named and marked: [Settings etiquette](settings-etiquette.md)
(a draft, for discussion).

### The inventory, and its check

[`docs/settings-inventory.yaml`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/docs/settings-inventory.yaml)
lists every setting in Settings: its home (`settings`, or `settings:mac-app`),
its section, who stores it, and its control's test id. Each control carries a
literal `data-testid="setting-…"`. `frontend/src/settingsInventory.test.ts`
(vitest) fails when a control isn't listed, a setting has no control or more
than one, a Mac app setting's control is outside `MacAppSettingsSection.tsx`,
or a control is not rendered by the file of the section the inventory puts it
in (`frontend/src/components/common/settings/<Section>Section.tsx`).

**When you add or change a setting:** add its entry to the inventory with its
section, give its control a `setting-…` test id, and for a Mac app setting add
its key to the Mac app's `SettingsBridge.macAppKeys` and the copy in
`NativeWindowPolicyTests`.

### The `pnvSettings` contract

`postMessage` returns a Promise; a refused or malformed message rejects it.

| Message | Reply |
|---|---|
| `{op: "get"}` | settings: `{install: {running, choice, checkoutPath, includedVersion, recentCheckouts}, autoRestart, launchAtLogin, developerMode, reportSendWith, reportSendTo, reportSendToDefault}` |
| `{op: "set", key, value}` — `autoRestart`, `launchAtLogin` or `developerMode`, a boolean | the settings, updated |
| `{op: "set", key, value}` — `reportSendWith` (`"ask"`, `"mail"`, `"outlook"`, `"gmail"`) or `reportSendTo` (an email address, or `""` for the default contact), a string | the settings, updated; an address that doesn't look like one is refused with the reason |
| `{op: "checkInstall", choice: "bundled" \| "checkout", path?}` | `{decision: "nothingToDo" \| "useBundled" \| "useCheckout" \| "refuse", message, path?}` |
| `{op: "switchInstall", …same}` | the same; when it is a switch, the app then stops, switches and starts again |

### The `pnvFile` contract

The file bridge (`utils/fileBridge.ts`) has three ops. `open` and `saveAs`
reply `{path}` (null when cancelled). `reveal` (#1295) shows a folder or
file in Finder:

| Message | Reply |
|---|---|
| `{op: "reveal", path}` | `{revealed: true}`; or the Promise rejects with an Error whose message is shown to the user ("There's no folder at …") |

An app from before the op (0.5.15 and earlier) answers without `revealed:
true` or rejects with an unknown-op message; the page treats both as "not
supported", copies the path instead and says *"Copied the path. Update the
PsyNeuView app to open folders in Finder."* In a browser the button is
**Copy path**. Where everything lives, and the naming rule for folders
PsyNeuView makes: [Where PsyNeuView keeps things](where-things-live.md).

`reportSendToDefault` is the contact reports go to when **Send to** is empty.
It is the app's (`ReportDefaults.contactEmail`); the page shows it but never
writes it. What Report a Problem collects and how it is sent:
[Reporting a problem](#reporting-a-problem-mac-app), below.

The app sends `pnv:mac-settings-changed` (detail: the settings) after any
change, so every window agrees, and `pnv:open-settings` for ⌘, — also setting
`window.__pnvOpenSettingsRequested`, which the page checks when it starts, so a
request made while the page was loading isn't lost.

### Diagnostics: `window.__pnvDiagnostics`

Once the app has loaded, the page defines one function the Mac app's Report
a Problem calls ([#1287](https://github.com/jonhanke-nam/PsyNeuView/issues/1287),
[PsyNeuView-MacApp#208](https://github.com/jonhanke-nam/PsyNeuView-MacApp/issues/208)):

```js
const { version, state, activity } = await window.__pnvDiagnostics();
```

It is built fresh on every call, so it is always current. An older page has
no such function, and the report simply leaves the page's part out. In a
browser, **Settings ▸ About ▸ Download diagnostics** saves the same object
as `psyneuview-diagnostics-<UTC time>.json`.

`version` is `1`, and goes up when the shape changes in a way an older
reader could misread. The code is `frontend/src/utils/diagnostics.ts` (the
snapshot) and `frontend/src/utils/activityLog.ts` (the log).

**`state`**, a snapshot of the page:

| Field | What's there |
|---|---|
| `app` | `psyneuviewVersion`, `buildCommit` (the server's); `pageVersion`, `pageCommit` (this page's own build), `pageMatchesServer` (true, false, or null when it can't be told) and `versionWarning` (a sentence when they differ — a window showing a stored copy of an older page, #2); `deployment` (`local`, `mac_app`, `container`, `hosted`); `running` (#1356), from `/api/settings/running` (3-second timeout; `{error, page}` when it fails): `summary` (the start-up log's line), `kind` (`included` — the Mac app's copy; `checkout`; `copy` — no git), `deployment`, `appFlavor` (`release`/`test`, from the Mac app), `path` (as `~`), `version`, `branch`, `onMainBranch`, `commit`, `commitDate`, `dirtyFiles`, `upstream`, `aheadBy`, `behindBy` (against the branch it tracks), `mainBranch` and `behindMain` (against `origin/devel`), `lastFetched` — all as last fetched — `gitError`, `startedCommit` (the code the server runs) and `movedSinceStart`; `page` — this page's build: `version`, `commit`, `commitDate`, `dirty`, `builtAt`, `devServer`, and `relation` to the server (`same`, `page_older`, `page_newer`, `different`, `unknown`); `pageFiles` — what `frontend/dist/build-info.json` on disk came from, and its `relation`; `mismatch` — the warning About shows (`page-older`, `page-newer`, `different`, `page-files-older`) or null |
| `model` | `open`; `path` (the home folder as `~`); `section` — the Open menu section it came from (`myModels`, `library`, `examples`, `references`, `demos`, `catalog:<id>`) — and `catalog`, its name; `kind` (`yours`, `library`, `example`, `reference`, `demo`, `other`); `unsavedChanges`; `viewOnlyLock`; `editRule` — which of the model's own rules makes it read only: `lock`, or a protection line in the file, `protected` or `protectedPermanently` (#1346); `protectedByLocation` with `protectedReason` (a PsyNeuLink file that can't be edited, #1225/#1305) |
| `ui` | `developerMode`; `openMenu` — `order`, `shownDevSections`, `collapsed`; `layout` — `visiblePanes` (`code`, `graph`, `bottom`, `palette`), `activeBottomTab`, `settingsOpen`, `activeSettingsSection`; `graph` — `edgeStyle`, `pointer`, `pointerSize`, `direction`, `layoutStyle`, `view` (`nested`, `flat`, `pytorch`); `keyboardOverrides` — `count` and the `ids` rebound; `walkthrough` — the running one's `id` and `step`, or null |
| `psyneulink` | `source` in words ("PrincetonUniversity/PsyNeuLink @ devel", "your checkout at ~/code/PsyNeuLink"), `kind` (`pypi`, `github`, `editable`, `unknown`), `version`, `commit`, `path` (as `~`), `editable` (a checkout), `updateStatus` — the `updates` summary of `/api/settings/info` (#1304) |
| `server` | the relevant parts of `/api/settings/info`, fetched fresh with a 3-second timeout: `versions` (PsyNeuView and its commit, PsyNeuLink, ModECI MDF), `deployment`, `health`, `features`, `githubAuth` (`source` and `hasRepoScope` only — never the user name), `updates`. When the fetch fails, `{error}` stands here instead and `app` and `psyneulink` fall back to the last answer the page saw; the call itself never fails for this |

**`activity`**, the log since the page loaded: an array of
`{t, kind, text, data?}` — `t` an ISO time, `kind` one of the below — the
last 2,000 entries, oldest first.

| `kind` | Recorded for |
|---|---|
| `menu` | an item chosen in the Open, Tutorials or Layout menu (its label), a Settings section shown, a keyboard shortcut that did something |
| `model` | a model opened or reopened, saved, saved as, locked or unlocked, a checkout protected (`data.path`) |
| `setting` | a setting changed: `data.key` is its inventory id (`developer-mode`, `graph-pointer`, `open-menu-sections`, `keyboard-shortcuts`, `pnl-auto-update`, `catalogs`, …) and `data.value` the new value, for non-sensitive settings only — the address reports go to is recorded as changed, never what to |
| `run`, `learn` | started, then finished with `data.outcome` (`ok`, `failed`, `cancelled`), `durationMs` and, on failure, the `reason` |
| `step` | stepping through an execution trace: step, trial, autoplay, cleared |
| `walkthrough` | started, each step, ended |
| `file` | a change seen on disk — the model's file, or PsyNeuLink's own code in a checkout — and whether it was applied or asked about first |
| `notification` | every message shown to the user, with `data.type` (`error`, `warning`, `info`, `success`) |
| `error` | a model error shown in the diagnostics bar (once per distinct error) |
| `psyneulink` | a PsyNeuLink switch requested, succeeded, failed or cancelled; Check now; the Mac app switching which PsyNeuView runs |

**Scope.** Only PsyNeuView and PsyNeuLink: their state, settings, installs
and the system they run on. Names and paths are recorded, never a model's
source or any file's contents; the home folder is always `~`; nothing
personally identifiable (no names, no addresses, no GitHub user name); and a
value whose key looks like a token, password or secret is never recorded.
These rules are applied in one place, on the way into the log and on the
whole snapshot as it is returned, so a caller cannot forget them.

### The start-up phases: `PNV-START` lines

While the backend starts, the Mac app's starting window shows the real steps
with their times instead of one spinner
([PsyNeuView-MacApp#232](https://github.com/jonhanke-nam/PsyNeuView-MacApp/issues/232)).
The backend reports each step as one line on its **stdout**, flushed at once,
and the app parses them (`app/services/startup_phases.py`):

```
PNV-START <phase> <event> [elapsed=<seconds, one decimal>] [detail=<url-encoded text>]
```

`<event>` is `begin`, `end` or `skip`. `elapsed` is on `end` only (on
`skip`, no time was spent). `detail` is optional, URL-encoded with nothing
kept safe (`%20` for a space, `%3A` for a colon, and so on), so the line
always splits into fields on single spaces. A step that failed ends with a
`detail` that starts with `failed` (`detail=failed`, or
`detail=failed%3A%20<why>`); the start goes on regardless.

The phases, in order, each with a `begin` and then an `end` or a `skip`:

| Phase | What it is | `skip` means |
|---|---|---|
| `migrate` | moving working copies and layouts from where older versions kept them (#1319, #1321) | — |
| `pnl-update` | installing a PsyNeuLink update the last session marked ready (#1304); checkouts set to pull on launch are pulled here too, and then the line is an `end` with `pulled N checkout(s)` in its detail | nothing to install: `no update ready`, `automatic updates are off`, `already installed`, or `update checks are off in this process` |
| `import-psyneulink` | the model runner importing PsyNeuLink: from spawning the worker to its ready signal, which it prints right after `import psyneulink` (the interpreter's own start, well under a second, is inside this) | the runner was already running in this process (a reload or a test harness) |
| `warm-worker` | the rest of the model runner's warm-up after that signal: next to nothing today, since the runner is ready once PsyNeuLink is imported; the step exists so later warm-up work has a place | — |
| `ready` | one line, `PNV-START ready end elapsed=<total>`, written the moment uvicorn can answer `/health`; its `elapsed` is the whole start, counted from when the process began (from the OS when `psutil` is importable, else from the backend's first import) | — |

A start on a warm Mac, for example:

```
PNV-START migrate begin
PNV-START migrate end elapsed=0.0
PNV-START pnl-update begin
PNV-START pnl-update skip detail=no%20update%20ready
PNV-START import-psyneulink begin
PNV-START import-psyneulink end elapsed=1.6
PNV-START warm-worker begin
PNV-START warm-worker end elapsed=0.0
PNV-START ready end elapsed=2.1
```

Before the first phase line the backend prints one plain line saying what
is running (#1356), for whoever reads the log; it doesn't start with
`PNV-START`, so the parser passes over it:

```
PsyNeuView 0.5.15 running from your checkout at ~/Documents/PsyNeuView (devel, abc1234)
PsyNeuView 0.5.15 running from the version included with the Mac app (~/Library/Application Support/PsyNeuView/psyneuview-0.5.15)
```

The same events go to the normal log in plain words ("Loading PsyNeuLink in
the model runner: done in 1.6s"), so the Logs window reads naturally. Nothing
in the reporter can fail a start: a stdout that is closed, or a line that
can't be formatted, is logged and skipped. `backend/tests/test_startup_phases.py`
pins the format, the context manager and the order the lifespan emits them in.

## Reporting a problem (Mac app)

When something goes wrong in the Mac app, **Help ▸ Report a Problem…** gathers
what the PsyNeuView team needs into one folder, without Terminal or accounts
([PsyNeuView-MacApp#202](https://github.com/jonhanke-nam/PsyNeuView-MacApp/issues/202)).
It is also a button in the **Logs** window, and on the starting window when
PsyNeuView doesn't start. The report screen lives in the Logs window, one of
the allowed native windows, so it works even when PsyNeuView can't start.

**What's collected.** Your description of what happened and, optionally, what
you expected. (PsyNeuView's `/api/settings/info` carries, under `updates`,
whether PsyNeuLink is current, when that was last checked and how the last
automatic update went, and `/api/settings/pnl-updates` the full record with
each checkout's — for the report to include, #1304; PsyNeuView-MacApp#208.) Then a **screenshot of the app window**, taken by the app (no
screen-recording permission), plus any you add; the **versions** of the Mac
app, PsyNeuView and PsyNeuLink (with its source), and **where PsyNeuView runs
from**; the **startup and update outcome** (how this launch's start went, the
step-by-step checklist with times, and the last move to the PsyNeuView
included with the app); the **last 500 log lines**; and the **macOS version
and Mac model**. Each item has a checkbox and a **View** button, so you see
exactly what will be saved and can leave anything out.

**What the page adds.** When the PsyNeuView page is open, the report also
asks it for its [diagnostics](#diagnostics-window__pnvdiagnostics): a
snapshot of the page's state — the open model and where it came from,
developer mode, the layout, the walkthrough and its step, which PsyNeuLink —
and the activity since launch: menu commands, models opened and saved,
settings changed, runs and learning with their outcome, file changes seen on
disk, every message shown ([#1287](https://github.com/jonhanke-nam/PsyNeuView/issues/1287),
PsyNeuView-MacApp#208). Names and paths, never a model's contents. In a
browser, the same file comes from **Settings ▸ About ▸ Download
diagnostics**; attach it to what you send.

**What's removed.** Tokens and passwords, always: GitHub tokens, credentials
in links (`https://x-access-token:…@github.com`, `https://user:password@…`),
`Authorization` headers, and anything after `token=` or `password=`. Your home
folder is shown as `~`. Screenshots are saved as taken, so check them with
**View**.

**The folder.** **Save Report** writes it to Downloads, with a `.zip` of it
beside it, and shows it in Finder. Its name is the report's reference; quote
it if you write about the problem later.

```
PNV-debugging-2026-10-06_14-03-22/
    report.md           a readable summary, your description first
    screenshot-1.png    the app window (and any you added)
    logs.txt            the last 500 log lines
    diagnostics.json    the same facts, for tools
PNV-debugging-2026-10-06_14-03-22.zip
```

**Sending it.** After saving, the screen says where to send it and offers
**Copy summary** (a short text version for a chat message), **Share…** (the
macOS share sheet: Mail, Messages, AirDrop, and Slack or Teams if installed,
with the report attached), **Email** (your default mail app, Mail or Outlook,
with the report attached and addressed) and **Gmail** (Gmail in your browser
with the summary filled in; a link can't attach files, so attach the folder
from Downloads there). With developer mode on, it also offers **Open as GitHub
issue**, prefilled; drag the screenshot in.

Two settings in **Settings ▸ Problem reports** (a section listed only inside
the app) choose how:

- **Send reports with**: *Ask each time* (every way, the default), *Mail app*,
  *Outlook* or *Gmail*. The screen leads with your choice; if it isn't
  available (no mail app set up, or Outlook isn't your default mail app), it
  says so and offers the other ways.
- **Send to**: the address reports go to. Empty means the PsyNeuView team's
  contact, shown in the field.
