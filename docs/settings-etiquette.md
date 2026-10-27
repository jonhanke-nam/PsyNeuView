# Settings etiquette

> **Draft, for discussion.** Written as part of the Settings redesign
> ([#1290](https://github.com/jonhanke-nam/PsyNeuView/issues/1290)) so that a
> new setting follows the same rules without a debate each time. Nothing here
> is final until it has been talked through; change it in a pull request like
> anything else. The rules that are already policy — one Settings, one control
> per setting, the inventory and its check — are in
> [Settings and the Mac app](settings-and-mac-app.md).

Settings is a sidebar of sections: **About**, **General**, **Appearance**,
**Open menu**, **Folders**, **Keyboard shortcuts**, **Problem reports** (the
Mac app's, listed only inside it), **Developer (advanced)**. A new user meets the
simplest, most useful things first; Developer is last, in the list rather than
pinned to the bottom, so a short window still shows it. Each setting is listed in
[`settings-inventory.yaml`](https://github.com/jonhanke-nam/PsyNeuView/blob/devel/docs/settings-inventory.yaml)
with its section, and a test fails when the code and the inventory disagree.

## 1. Which section a setting belongs in

Ask, in this order:

1. **Is it a version or a name, to read rather than change?** Then
   **About**, one line each and no paths: what someone writing to us needs.
   The one action that belongs with them, **Download diagnostics** (#1287),
   lives there too, in a browser; the Mac app's Report a Problem covers it.
2. **Would a regular user change it in a normal week** — how the app starts,
   a preference about their own work? Then **General**.
3. **Is it about how the app looks or feels, rather than what it does** —
   the pointer in the graph view and its size (#1301), and whatever
   look-and-feel settings come next (sizes, colours, a theme)? Then
   **Appearance**. A look-and-feel setting is remembered per browser, like
   the Open menu's order: a personal preference on a shared backend. Window
   zoom (⌘+ / ⌘−) is the browser's, not a setting, and doesn't scale the
   pointer; the size setting is the one control for that.
4. **Is it about the Open menu's shape** — the sections' order, which
   catalogs under development show? Then **Open menu**. Only the shape: what
   a section lists is Folders.
5. **Is it something you can open, and where it lives** — My Project Folder,
   a catalog (adding, renaming, removing one), the Library and Examples from
   the selected PsyNeuLink, the models included with PsyNeuView? Then
   **Folders**, one compact row each in the Open menu's order, with its path,
   whose it is, and Show in Finder (#1295). Where PsyNeuView and PsyNeuLink
   themselves are installed is Developer's.
6. **Is it a keyboard binding?** Then **Keyboard shortcuts**.
7. **Does it concern reporting a problem?** Then **Problem reports**, the Mac
   app's section, listed only inside it.
8. **Would only a developer change it or need it**, or does it change what
   the app runs (which PsyNeuView, which PsyNeuLink)? Then **Developer**,
   below the developer-mode switch: where the two are installed and the
   PsyNeuLink details (repo, branch, commit, path, freshness) live there,
   not in About or Folders.

A setting that is Mac-app-only goes in the same section a browser setting of
its kind would, shown only when the bridge is present (`hasSettingsBridge()`).
There is no "Mac app" section: the platform is not a reason to group things.
Problem reports is a section *about reporting*, which happens to be the app's;
it is listed only inside the app (`macAppOnly` in `sections.ts`).

A new section needs a reason the eight can't absorb, and goes between General
and Keyboard shortcuts, never after Developer. Appearance (#1301) is the
one added so far: look and feel is neither a preference about your work
(General) nor the Open menu's shape, and it will grow.

> **TODO (naming, pending a decision):** "My Project Folder" and "catalogs"
> keep their names for now. "Project" is ambiguous — a project folder, a
> folder of scripts, a catalog, a project, or a PsyNeuLink repo could all be
> meant. The candidates on the table: *My Project Folder*, *script folders*,
> *catalogs*, *projects*, *PsyNeuLink repos*. Decide once, then rename in the
> Open menu, Settings ▸ General and Settings ▸ Open menu, the inventory and
> the docs together.

## 2. Simple before advanced

Within a section, the order is the order a new user needs: the thing most
people change first, then the rest, then anything that is advanced. The
developer-mode switch is the first item of Developer because a regular user
turns it on there; everything after it is for developers.

A section should fit without scrolling for most people. If it doesn't, fold
rather than paginate (next rule).

## 3. What folds, and what a folded group summarises

Related settings sit in a **group** with a heading. A group folds. A group
**starts folded** when it is rarely changed or long:

- **Problem reports** (About): folded; summary *"Send with the Mail app, to
  help@example.org"*.
- **Which PsyNeuView runs** (Developer, Mac app): folded; summary *"Running
  now: PsyNeuView 0.5.14, included with this app"*.
- **Manage known sources** (Developer): folded under the Switch to dropdown,
  with the count, *"Manage known sources (10)"*: Rename and Remove are
  housekeeping, not something to switch with.

A folded group's summary is **one line, in plain words, saying the group's
current state**: what is chosen now, not what the group is for. ("Send with
the Mail app", not "How reports are sent".) It may be truncated with an
ellipsis; the full state is one click away.

Groups that are read-only (About, Folders) or that a new user is likely to want
(the project folder, the developer-mode switch) start open.

Fold state is not remembered between opens; a group that should be open on
return should simply start open.

## 4. A setting that needs a restart

Say so **in the control's own words, before it is applied**, and name what
restarts: *"Switching stops PsyNeuView and starts the one you pick"*;
*"Apply & restart"* on the button. Never apply a restart-needing change
silently, and never ask a second time in a dialog if the button already says
restart. After it is applied, say what happened where the user is looking
(*"Install succeeded. PsyNeuLink details below shows the new version."*).

## 5. Developer-only settings

Everything developer mode adds, and every setting only a developer changes,
carries the **Developer badge** (`frontend/src/components/common/DeveloperBadge.tsx`,
[#1291](https://github.com/jonhanke-nam/PsyNeuView/issues/1291)): one small
mark in one colour, with a tooltip that explains itself. It has two readings:

- **Shown because developer mode is on** — the tooltip *"Shown because
  developer mode is on; regular users don't see this"*. Used wherever
  developer mode added something: the Open menu's catalogs under development
  and its Developer / Tests entry, the toolbar indicator.
- **For developers** — the tooltip *"A developer's setting; regular users
  don't need it"*. Used on the Developer section's own groups, which are
  listed whether or not developer mode is on, and on a note that only
  applies to developer setups (the project folder fixed by an environment
  variable). The sidebar item itself says "(advanced)" instead of carrying
  the badge.

An Open menu section is marked **only when it is visible because of developer
mode**. One the user switched on in Settings, or one a running walkthrough
opened, is shown for a different reason and is not marked
(`isShownOnlyByDeveloperMode` in `frontend/src/stores/openMenuOrder.ts`).

In the inventory, a developer-only setting has `developer_only: true` and its
section is `developer`; the check enforces that.

## 6. Naming

- **Plain English**, in the words a user would say: *"Open PsyNeuView when you
  log in"*, not *"Launch at login"*; *"Restart PsyNeuView if it crashes"*, not
  *"Auto-restart"*. No abbreviations a newcomer would have to look up.
- **The same names as PsyNeuLink** for PsyNeuLink's things (a Composition is
  a Composition; the Library is the Library), and the same names PsyNeuView
  already uses elsewhere (the **Open menu**, not "the Load Model dropdown";
  **My Project Folder**; **nested**, not "flat"). Don't invent a second name
  for something that has one.
- **A setting is named by what it does**, with the choices as nouns: *"Sidecar
  files (new models)"* with *"Beside the .py"*. A switch reads as a sentence
  that is true when it is on.
- **Name the real thing** when an explanation refers to something concrete:
  the environment variable that fixed the project folder, the branch that is
  installed, the path.
- **A path is shown on its own line**, in the "Full path" box (`PathBox` in
  `settings/shared.tsx`): monospace, `~` for the home folder, the full path
  as the tooltip, wrapping after a `/` rather than mid-word. Never run a path
  into a sentence. What is stored stays the full path.
- **Say who a thing is for** when it is not for everyone: *"…which developers
  and the test suite set. Regular users never need it."*, with the badge.
- **Folders and files PsyNeuView makes for people** use hyphens between
  words, PsyNeuView first: `PsyNeuView-My-Models` (the default project folder
  under `~/Documents`, one constant in `backend/app/services/model_dirs.py`).
  No spaces or underscores. The one exception is the problem-report folder
  `PNV-debugging-YYYY-MM-DD_HH-MM-SS`, which keeps its single underscore
  between the date and the time. Hidden app-data folders (`~/.psyneuview`)
  keep their names. The user-facing *labels* ("My Project Folder") are
  separate and wait for the naming decision above.

## 7. Where help text goes

- **One sentence under the setting's name**, in smaller grey text, saying what
  it changes and, if it matters, what it doesn't: *"Existing files aren't
  moved."* No help text for a setting whose name says it all.
- **A note under a group**, in the same style, for what applies to the whole
  group: *"You can also drag a section by its heading in the Open menu."*
- **A tooltip** only for something that is already visible and only needs
  its full form: a truncated name, a badge, the × ("Close (Escape)").
- **Longer explanations** go in `docs/` and are linked, not inlined.

## 8. One control per setting

The One Settings policy ([#1279](https://github.com/jonhanke-nam/PsyNeuView/issues/1279)):
a setting has exactly one home and one control, listed in the inventory. The
toolbar's Developer indicator offers *"Turn off developer mode"* as a shortcut
to the one control in Settings ▸ Developer, not as a second setting; a menu
item that changes a setting routes into Settings the same way. A second way
to change a setting is a bug, with one known exception to decide: the Open
menu's order can be changed by dragging in the menu as well as in Settings.

**The one allowed second view: simple + advanced.** A Developer setting
that regular users also need may have a *simple view* in the section where
they would look, as long as it is the same setting: it reads the same stored
value, writes it through the same mechanism, and never becomes an
independent picker. Which PsyNeuLink is installed is the case
([#1295](https://github.com/jonhanke-nam/PsyNeuView/issues/1295) round 4):
**General ▸ PsyNeuLink version** offers *Latest development* (recommended,
the default — the recommendation is one constant, `RECOMMENDED_PNL_CHOICE`)
or *Official release*, and **Developer ▸ Which PsyNeuLink is installed** has
the full form; both post the same install request
(`settings/useInstallJob.ts`). When the installed PsyNeuLink is anything
the simple view can't express — another repo or branch, a checkout — the
simple view says *"Custom (set in Developer)"* with a link, rather than
showing radios that would mislead. In the inventory the setting lists
`simple_control` and `simple_section` beside its `control`, and the check
allows exactly that pair.

## 9. Closing

Every dialog closes with the × in its fixed header, with Escape, and, where it
already does, by clicking outside ([#1288](https://github.com/jonhanke-nam/PsyNeuView/issues/1288),
[#1289](https://github.com/jonhanke-nam/PsyNeuView/issues/1289)). Settings
uses `useDismiss` and `DialogHeader` (`frontend/src/components/common/dialog/`);
a new dialog uses the same two rather than handling Escape on its own, so
Escape always reaches the innermost open thing first, and is listed in
[`dialog-inventory.md`](dialog-inventory.md), where every dialog, panel and
pop-up menu is; a guard test fails when one draws an overlay without the
shared pieces, and an end-to-end sweep opens each and closes it with Escape.

## 10. An action button appears only when pressing it would change something

A new user is easily distracted by a button that doesn't need pressing
([#1303](https://github.com/jonhanke-nam/PsyNeuView/issues/1303): an
**Apply & restart** sat there, blue and clickable, under a form that already
described the installed PsyNeuLink). So:

- **Nothing to apply: no button.** A quiet status line takes its place,
  saying what is in use: *"✓ In use now: your checkout at ~/code/PsyNeuLink"*
  (`InUseNow` in `settings/shared.tsx`).
- **Something to apply: the button,** with one line saying what it will do
  and that nothing happens until it is pressed: the pre-switch summary, then
  *"Nothing changes until you press Apply & restart."* (`ApplyExplanation`).
- **Hide, don't grey out.** A disabled button still draws the eye and raises
  the same question. (A button a form disables while its input is incomplete
  or invalid — a blank path, a repo that isn't `owner/name` — is form
  validation, not this rule.)
- **Settings that apply instantly** — switches, dropdowns, Send to, the
  catalog list, the automatic-update switches (#1304) — never get an Apply
  button. A **Check now** beside a status line is an action, not a setting:
  it always does something (asks again), so it is always shown.
- **After applying,** the button goes away and the status line confirms the
  new state. Say it where the user is looking (§4).

Whether there is anything to apply is decided in **one place** the button,
the summary and the status line all read, normalised the way the request
is: for the PsyNeuLink setting that is `somethingToApply` in
`frontend/src/utils/pnlSources.ts` (repo case-insensitive, blank meaning the
default; a ref trimmed of slashes, blank meaning the installed branch; a
PyPI form without a version meaning the newest release; a local path with
`~` expanded and a trailing slash dropped). For the Mac app's Which
PsyNeuView runs it is the app's own `checkInstall` verdict: `nothingToDo`
and `refuse` both mean no button.

## 11. Status tags: show a status only when it is the exception

A tag in the toolbar (or anywhere else a status sits beside a thing) is shown
**only when the state is one the user would not assume**. The normal state
shows nothing. Every model used to carry an *editable* tag, which was noise,
and was easily confused with the PsyNeuLink install protection
([#1309](https://github.com/jonhanke-nam/PsyNeuView/issues/1309)).

- A model of your own, unlocked: **no tag**. There is nothing to say.
- A **locked** model: *view only*. The tag is a button, and its tooltip says
  what the lock means and that a click unlocks.
- A file of PsyNeuLink's own: a tag either way — *your PsyNeuLink checkout ·
  editing* or *PsyNeuLink from GitHub · read only* — because "this file is
  part of PsyNeuLink" is itself the exception, and what Save would do differs.
- When two rules apply, only the one that decides is shown: a read-only
  PsyNeuLink file shows no lock tag, and the lock items are hidden for it.

The action that changes a state has a home that does not depend on the tag
being there. Locking lives in the Layout menu (*Lock this model (view
only)*); unlocking is on the tag and in the same menu. Otherwise the tag
would have to be shown in the normal state just to be clickable, which is
the mistake above. The user-facing rules are on
[What you can edit, and why](what-you-can-edit.md).

## Appendix: what developer mode changes

Everything developer mode adds, so that a new developer-only feature has to
be added here and marked ([#1291](https://github.com/jonhanke-nam/PsyNeuView/issues/1291)).
The one control is **Settings ▸ Developer ▸ Under development ▸ Show what's still under development** (developer mode; #95)
(`useUIStore.developerMode`; inside the Mac app the app keeps the value,
`developerMode` over the `pnvSettings` bridge).

| Where | What developer mode adds | Marked how |
|---|---|---|
| Toolbar | A **Developer** indicator beside the app name and gear; clicking it offers *Turn off developer mode* and *Developer settings…* | it is the badge |
| Open menu | The catalogs under development: **PsyNeuLink Examples**, **Reference Models**, **Demo Models** (when not switched on in Settings ▸ Open menu, and no walkthrough has opened them) | badge after the section name |
| Open menu | The **Developer / Tests…** entry (open a PsyNeuLink pytest test as a model) | badge after the entry |
| Settings ▸ Open menu | The *show* switches for the catalogs above read as on and are disabled; the rows carry the badge when developer mode alone shows them (the catalogs under development always sit below the everyday sections, whoever shows them) | badge after the row's name; tooltip *"Always shown in developer mode"* |
| Settings ▸ Folders | The rows of the catalogs under development carry the badge under the same rule | badge after the row's name |
| Settings ▸ Developer (advanced) | Nothing: the section is always listed. Its developer-only groups carry the "for developers" badge whether or not the mode is on | badge on the groups; "(advanced)" in the sidebar |
| Mac app (separate repo) | Its developer menu items, all branches in Switch Branch, and *Open as GitHub issue* in Report a Problem | to be marked there (PsyNeuView-MacApp) |
