# Deployment modes

PsyNeuView declares what kind of deployment it is running in, rather than
guessing from the shape of incoming requests. Privileged surfaces — switching
the installed PsyNeuLink, reaching the host filesystem, using the host's GitHub
credentials — derive from that declaration.

Set it with `PSYNEUVIEW_DEPLOYMENT_MODE`. Unset means `local`, so a normal
`make start` and the Mac app behave exactly as they always have.

## The modes

| Mode | What it means |
|---|---|
| `local` | A developer's own machine — `make start`, or a checkout run by hand. The default. |
| `mac_app` | Launched by PsyNeuView-MacApp. Same Settings as everywhere — the app's `Cmd+,` opens it — plus the Mac app's own settings, each in the section it belongs to, through the app's bridge ([Settings and the Mac app](settings-and-mac-app.md)). |
| `container` | One user, one process, in a container on a shared host (Docker or Apptainer). |
| `hosted` | The multi-tenant service. Not implemented yet — the mode exists so capabilities can be declared against it rather than discovered later. |

## What each mode allows

| Capability | `local` | `mac_app` | `container` | `hosted` |
|---|---|---|---|---|
| Switch the PsyNeuLink source (pip install) | yes | no | no | no |
| Use the host's GitHub credentials | yes | yes | no | no |

A GitHub token — whether from `gh auth token` or an ambient `GITHUB_TOKEN` —
belongs to whoever runs the server. Handing it to whoever opens the page would
give a visitor the operator's account, so `container` and `hosted` resolve
unauthenticated and fall back to public read-only access.

**Not in the table: confining host filesystem access.** Every model route still
takes an absolute `file_path`, so a capability claiming otherwise would be a
false statement in an API response. That confinement is tracked in
[#1058](https://github.com/jonhanke-nam/PsyNeuView/issues/1058), where
workspaces replace paths — until it lands, a `container` deployment must be one
user per container, with the container itself as the boundary.

`/api/settings/info` reports the active mode and this table under `deployment`,
so the frontend can hide controls that cannot work here instead of offering
them and reporting a failure afterwards.

## Why this replaced the loopback check

Privileged endpoints used to ask whether the client address was loopback. That
is a sound proxy for "trusted local" on a laptop, and wrong as soon as the app
runs in a container:

- **Apptainer reached over an SSH tunnel** — the normal HPC access pattern —
  presents a loopback client for a remote user, against a read-only squashfs
  venv. The install controls would be offered and would then fail partway
  through a pip run.
- **A reverse proxy on the same host** presents loopback for every visitor.

The mode is now consulted first. Loopback is still checked *in addition* for
install in `local` mode, so a backend bound to `0.0.0.0` does not hand pip to
the network — it simply cannot grant anything on its own any more.

An unrecognized value falls back to `local` with a warning in the log. A typo in
a deploy script should not take the backend down, and `local` still requires
loopback, so the fallback cannot quietly grant remote access.

## Notes for operators

- In `container` mode the PsyNeuLink version is fixed by the image. That is
  deliberate: a container's venv is read-only, and pinning the version is what
  makes a deployment reproducible.
- `PSYNEUVIEW_MAC_APP=1` is the deprecated predecessor of this variable. It is
  still honored, but new deployments should set `PSYNEUVIEW_DEPLOYMENT_MODE`.
