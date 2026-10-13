# PsyNeuView web app — Getting Started on macOS (click-by-click)

Paste each block into Terminal, press **Return**, wait for the `$` prompt to
come back before the next one. Scrolling text is normal. About 20 minutes,
almost all of it waiting on Step 5.

> **This page installs the PsyNeuView web app** — the React frontend and its
> Python backend, running locally and opened in your browser. It is not the
> native Mac app, which is a separate product and not covered here.

**You need:** a Mac, and a GitHub account added to the private PsyNeuView repo
(Step 4 tells you if you're not).

Open Terminal: **⌘ + Space**, type `Terminal`, **Return**.

---

## Step 1 — What's already installed?

```bash
for c in brew git node gh; do
  command -v $c >/dev/null && echo "have  $c" || echo "NEED  $c"
done
if command -v python3.14 >/dev/null || command -v python3.13 >/dev/null \
   || command -v python3.12 >/dev/null; then
  echo "have  python"; else echo "NEED  python"; fi
```

- All five say `have` → skip to **Step 4**
- `NEED brew` → **Step 2**
- Otherwise → **Step 3**

---

## Step 2 — Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Asks for your Mac password → type it (nothing appears as you type — normal).
Says "Press RETURN to continue" → press Return.

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"
brew --version
```

- Version number → **Step 3**
- `command not found` → older Intel Mac. Run this, then re-check:

  ```bash
  echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/usr/local/bin/brew shellenv)"
  ```

---

## Step 3 — Python, Node, git, GitHub CLI

```bash
brew install python@3.14 node git gh
```

A few minutes. Anything you already have is skipped automatically.

---

## Step 4 — Sign in to GitHub, download PsyNeuView

```bash
gh auth login
```

Arrow keys + Return: **GitHub.com** → **HTTPS** → **Yes** → **Login with a web
browser**. Copy the one-time code it shows — eight characters with a dash, like
`DAAA-1594` — press Return, paste it in the browser that opens, click
**Authorize**.

> **You may be asked for a *second*, different code.** If GitHub shows
> **"Confirm access"** and says it sent a verification code to your email, that
> is a separate step from the one-time code above and a different code entirely
> — do not paste the `DAAA-1594`-style one here. GitHub does this when it wants
> you to re-confirm it is really you ("sudo mode").
>
> - Check your email, including **spam** — it is a common place for it to land.
> - Enter that code and click **Verify**.
> - Some accounts never see this. If you do not, nothing is wrong.

Then come back to Terminal. It should say you are logged in.

Then download it. The first line picks the folder deliberately — without it the
download lands wherever your Terminal happens to be:

```bash
cd ~
gh repo clone jonhanke-nam/PsyNeuView && cd PsyNeuView
git switch devel
pwd
```

`pwd` prints where it went. It should say `/Users/<your-name>/PsyNeuView` — a
folder in your home directory, alongside `Documents` and `Desktop`. **Write that
path down; later steps and the PyCharm setup both need it.**

The `git switch devel` line is not optional. Downloading gives you the `main`
branch, which is dormant and roughly a thousand commits behind the version
everyone actually uses. Skipping it means the later steps fail with
`No rule to make target 'run-devel'` — and, more confusingly, `make install`
appears to succeed while installing the wrong thing.

- `Repository not found` → your account isn't on the repo yet. Send the
  maintainers your GitHub username, then run this line again.

---

## Step 5 — Install

```bash
make install
```

**The slow step** — downloads the full scientific stack the first time.
Warnings scrolling by are normal. Wait for the `$` prompt.

If it stops with a Python version error, it names the interpreter to use — run
the `make install PYTHON=...` line it prints.

---

## Step 6 — Run

```bash
make run-devel
```

Wait for it to print **http://localhost:5173**. Leave this Terminal window open.

> **`run-devel` vs `run-release`.** `run-devel` runs the current development
> version — what you want while the app is under active development.
> `run-release` runs a *pinned* release tag, and "release" here means one
> specific saved snapshot, not "the newest one": the Makefile hardcodes which,
> and it only changes when someone edits it. `git tag -l '*release*'` lists what
> exists. If you want a specific one: `make run-release RELEASE=<tag>`.

Open **Chrome** (Safari works too), go to **http://localhost:5173**, click
**Load Model**, pick one of the built-in demo models. That's it. 🎉

> *(Later, not now.)* `make run-devel` runs the newest development version
> instead of the stable release.

---

## Everyday commands

Back in Terminal, in the `PsyNeuView` folder (`cd PsyNeuView` if you're not):

| | |
|---|---|
| Stop the app | `make stop` |
| Start the stable release | `make run-release` |
| Start / update to the latest | `make run-devel` |
| See what's running | `make status` |
| See all commands | `make help` |

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `command not found: brew` | Re-run the **Step 2** `.zprofile` line (or the Intel one) |
| `command not found: make`, `python`, `node`, `gh` | Re-run **Step 3** |
| `Repository not found` | Not added to the private repo — see **Step 4** |
| `No rule to make target 'run-devel'` | You are on `main`. Run `git switch devel`, then `make install` again — see **Step 4** |
| GitHub asks to "Confirm access" with an emailed code | Normal — a second, different code from the one Terminal showed. Check spam, enter it, **Verify**. See **Step 4** |
| Python version error, or install crawls / errors about "wheels" | Run the `make install PYTHON=...` line it prints |
| `Port in use` | `make stop-all`, then start again |
| Blank browser page | Wait a few seconds, reload. Still blank → `make stop`, then `make run-devel` |

Anything else: copy the last chunk of error text and send it to the maintainers.

---

## Next: using it with PyCharm

If you write your models in PyCharm and want to keep doing that — editing there
and watching the graph update here — there are two routes. Take the one that
describes you:

- **You already work in PsyNeuLink**, with a checkout you develop against and
  PyCharm set up for it →
  [**Already a PsyNeuLink developer? Keep your setup**](./existing-psyneulink-setup.md).
  Leave PyCharm alone; point PsyNeuView at the PsyNeuLink you already have.
- **This machine is new to Python**, or you have no PsyNeuLink setup to protect →
  [PyCharm setup on macOS](./pycharm-setup-macos.md), which configures PyCharm
  from scratch.

Then confirm the two are talking to each other with
[the sync check](../tutorials/13-sync-check.md).
