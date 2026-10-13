# Branching Strategy

## Branches

| Branch | Purpose | Notes |
|--------|---------|-------|
| `devel` | **The trunk.** Everything lands here. | Protected: required checks, `enforce_admins` on — there is no bypass, for anyone. |
| `devel-unsafe` | Work that can't be green yet | Same gates, advisory. Use this instead of pushing red work to `devel`. |
| `feature/*` | One branch per issue | Merged by PR into `devel`. |
| `feature/tutorials` | Long-lived integration branch for tutorial work (#1180) | Slices PR into it; it merges into `devel` as a whole. Runs a reduced check set — see [docs/testing.md](docs/testing.md). |
| `demo` | Deployment pointer, not a development branch | Advanced with `git push origin devel:demo`. See [docs/deployments.md](docs/deployments.md). |
| `main` | Dormant | GitHub's default branch, which is a historical accident rather than a statement of intent. **Nothing promotes from `devel` to `main`.** |

There is **no `stable` branch.** An earlier version of this document described one
at length; it has never existed in this repository.

## Workflow

```
issue → feature/my-change → PR → devel
```

```bash
git checkout devel && git pull
git checkout -b feature/my-change
# ... work, commit ...
git push -u origin feature/my-change
gh pr create --base devel          # <- the --base matters, see below
```

**Always pass `--base devel`.** GitHub's default branch for this repo is `main`,
so `gh pr create` without `--base` targets the dormant branch and the PR will
look inexplicably enormous.

Bookkeeping changes — `TODO.md`, docs, a CI tweak — go through the same
issue → branch → PR path. `devel` takes no direct commits.

## What gates a merge into `devel`

Branch protection requires: `tutorials`, `e2e`, `typecheck (tsc)`,
`unit tests (vitest)`, `backend pytest`, `backend pytest (3.14)`.

`enforce_admins` is **on**, so a red PR cannot be merged by anyone, including the
repository owner. That's deliberate: if something needs to land before it can be
green, it goes to `devel-unsafe`.

A **skipped** check counts as passing. Each workflow triggers on all PRs to
`devel` and a cheap `changes` job decides whether the expensive job runs, so a
docs-only PR satisfies the required checks without paying for the installs. See
[docs/testing.md](docs/testing.md).

## Releases

A release is a **tag on `devel`** — not a branch, not a merge (#1073):

```bash
make release-tag VERSION=0.5.7
```

Latest is `v0.5.6`. Tags are the only marker of a public release; nothing is
copied anywhere.

## How the code reaches people

| Consumer | Mechanism |
|----------|-----------|
| **Mac app** | **Development ▸ Switch Branch** selects which PsyNeuView branch the app runs (`main`, `devel`, a feature branch), for checkout-based installs. It does not track a release branch — see the [Mac app README](https://github.com/jonhanke-nam/PsyNeuView-MacApp). |
| **Demo instance** | The `demo` branch, advanced by `git push origin devel:demo`. |
| **Containers** | `ghcr.io/jonhanke-nam/psyneuview:devel`. See [docs/deploying.md](docs/deploying.md). |

## Related repos

| Repo | Branch | Notes |
|------|--------|-------|
| **PsyNeuView** | `devel` | This repo. Releases are tags. |
| **PsyNeuView-MacApp** | `jonhanke-devel` | Releases are explicit DMG builds. |
| **PsyNeuLink** (Princeton) | `devel` | The operative default branch upstream — *not* `master`, despite GitHub's metadata. Selected per-source in the app. |
