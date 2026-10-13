# Contributing to PsyNeuView

Thanks for helping. PsyNeuView is a graphical interface for
[PsyNeuLink](https://github.com/PrincetonUniversity/PsyNeuLink); changes here
should keep PsyNeuLink's models and behaviour intact.

## How work flows

```
issue → branch → pull request → devel
```

- **`devel` is the trunk.** Every change lands there by pull request; it takes
  no direct pushes. Open PRs against `devel` (`gh pr create --base devel`), not
  `main`, which is dormant.
- **One branch per issue**, named for what it does (`fix/…`, `feature/…`,
  `docs/…`). Reference the issue in commits and the PR (`Refs #123`).
- **Small, focused commits** with messages that say what changed and why.

See [BRANCHING.md](BRANCHING.md) for the full branch model.

## What must pass

A PR merges only when its required checks are green: `backend pytest` (Python
3.13 and 3.14), `unit tests (vitest)`, `typecheck (tsc)`, `e2e` and
`tutorials`. Nobody can bypass them. Each check decides whether your change
needs it, so a docs-only PR doesn't pay for the full suite.

Every bug fix or feature should come with a test that would have caught it:
a backend `pytest`, a `vitest` unit test, or a Playwright e2e spec.

## Running things locally

```bash
make install                       # Python venv, backend deps, PsyNeuLink
make start                         # backend + frontend; open http://localhost:5173
make test                          # backend tests
cd frontend && npx vitest run      # unit tests
cd frontend && npx tsc --noEmit -p .
cd frontend && npm run test:e2e:ci # the e2e specs CI runs (tagged @ci)
```

A new e2e spec that CI should run gets the `@ci` tag and a line in
`frontend/e2e/ci-specs.txt`; a unit test checks the two agree. More in
[docs/testing.md](docs/testing.md).

## Style

- Match the code around you: its naming, comments and idioms.
- Frontend colours come from the palette (`frontend/src/styles/palette.css`);
  a test fails on hand-written colours.
- Write for people who weren't in the room: plain English in docs, comments,
  commits and PRs. Refer to people by role, not by name.

## Reporting problems

Bugs and ideas: open an issue. Security problems: see [SECURITY.md](SECURITY.md).
Questions: see [SUPPORT.md](SUPPORT.md).

By contributing, you agree that your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
