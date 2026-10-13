# Getting Started — run PsyNeuView locally (developer setup)

This is the local, developer path: clone the repo, install, and run PsyNeuView
on your own machine so you can use it *and* see/modify what's happening. All
active work lives on **`devel`** — that's the branch to stay on.

> Just want to use the app without a dev setup? The native macOS app installs
> and runs everything for you — see
> [PsyNeuView-MacApp](https://github.com/jonhanke-nam/PsyNeuView-MacApp).

> On a **Mac** and want a slower, click-by-click version (installs the tools for
> you, one line at a time)? See
> [**PsyNeuView web app — Getting Started on macOS (click-by-click)**](guides/psyneuview-web-app-getting-started-macos.md).

## Prerequisites

- **macOS or Linux** (Windows: use [WSL](https://learn.microsoft.com/en-us/windows/wsl/)).
- **Python 3.12, 3.13, or 3.14** — you don't have to check by hand: `make`
  verifies the version first and, if `python3` is out of range, names an
  interpreter you already have. If you have none, `brew install python@3.14`,
  then `make install PYTHON=python3.14`.
- **Node.js 18+** — `node -v` (includes `npm`).
- **git** and **make** — preinstalled on macOS/Linux.
- **GitHub access** to `jonhanke-nam/PsyNeuView` (the repo is private). You must
  be a collaborator — if `git clone` / `gh repo clone` fails with "Repository not
  found," you don't have access yet; ask the maintainers (see
  [collaborators](https://github.com/jonhanke-nam/PsyNeuView/settings/access), or
  open an access request) to add you. If SSH isn't set up, `gh repo clone` works
  after `gh auth login`.

## 1. Get the code

A fresh clone lands you on **`devel`** — the active branch and the one to stay on.

```bash
git clone git@github.com:jonhanke-nam/PsyNeuView.git
cd PsyNeuView
git branch --show-current      # -> devel
```

(No SSH key? `gh auth login` then `gh repo clone jonhanke-nam/PsyNeuView`.)

## 2. Install

Creates `backend/.venv`, installs the backend (editable) and its declared
dependencies, and PsyNeuLink from PyPI. The first run pulls the full scientific
stack (torch/numpy/scipy), so give it a few minutes.

```bash
make install
```

## 3. Run

```bash
make start            # backend :8000 + frontend dev server :5173, in the background
```

Open **http://localhost:5173**, then **Load Model** → pick a built-in demo, or
open a `.py` model file.

```bash
make stop             # stop both servers
make status           # show what's running
```

`make start` warns if you launch from a branch other than `devel` — stay on
`devel`.

## 4. Stay current on `devel`

```bash
make stop && git pull && make install && make start
```

`git pull` brings in the latest `devel`; `make install` picks up any new backend
dependencies.

## Seeing what's happening (it's all yours)

- It's a normal clone — open it in your editor, `git log`, edit freely. The
  backend is installed **editable** and runs with `--reload`, so backend source
  edits apply on the next request.
- To watch live logs, run the servers in the foreground in separate terminals:
  `make backend` and `make frontend`.
- Backend tests: `make test`. Every target: `make help`.

## PsyNeuLink source (optional)

- The default is PsyNeuLink from PyPI (stable). To point at a local or
  branch checkout instead:

  ```bash
  make install-all PSYNEULINK_DIR=/path/to/PsyNeuLink
  ```

  Switch back to PyPI anytime with `make install`.
- **The `devel` above is PsyNeuView's branch, not PsyNeuLink's** — two
  independent things that are easy to conflate. Staying on `devel` (steps 1–4)
  governs the **PsyNeuView app** only; it doesn't affect which PsyNeuLink library
  you run. By default `make install` installs PsyNeuLink from the **PyPI release**
  (no branch). If you switch to a GitHub source instead (in-app Gear panel, or the
  macOS app), PsyNeuView targets `PrincetonUniversity/PsyNeuLink` on the **`devel`**
  branch by default — that's PsyNeuLink's active development branch, which is what
  you want. (GitHub still lists `master` as that repo's metadata default, but
  PsyNeuView deliberately tracks `devel`.)
- Note: a few advanced run/debug features (value pill, trial stepping, Run
  State) rely on PsyNeuLink's internal `_debugger` hook. That hook was upstreamed
  into PsyNeuLink and shipped in **release 0.19.1.0** (2026-08), so the default
  PyPI install *and* current Princeton `devel`/`master` all include it — only
  older builds predating 0.19.1.0 lack it. See
  [Stepping with the debugger](tutorials/04-debugger-stepping.md) for how to
  confirm which build is active.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Install is very slow or fails on wheels | You're likely on Python 3.14 — use 3.12/3.13 (see Prerequisites). |
| "Port in use" on start | `make stop` (or `make stop-all` to clear every instance). |
| Frontend stale or `vite: not found` | `make install-frontend`. |
| Not sure what's running | `make status`; installed versions with `make info`. |
