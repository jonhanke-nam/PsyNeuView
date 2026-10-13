# Deployments

An inventory of **hosted instances that are running somewhere other than a
user's own machine** — what exists, on whose account, what it costs, and who
can reach it.

This is deliberately separate from [deploying](deploying.md), which describes
*how* to run PsyNeuView on each runtime. That is a pattern; this is a register
of live things with owners and bills attached.

**Not listed here:** the Mac app and the local dev server. They run on the
user's own machine with no account, endpoint or cost, so they belong with the
[getting started](getting-started.md) instructions rather than in an inventory.

## Both instances are currently paused

**Neither Railway instance is running.** Both URLs return 404. Nothing was
deleted — services, variables, domains, allowlists and volumes are all intact;
only the running containers are gone, which is what stops the compute bill.

| Instance | State | Comes back when |
|---|---|---|
| the demo instance | stopped | the `demo` branch moves — **still connected** |
| the devel instance | stopped | **never on its own** — its source is disconnected |

The devel instance was deliberately detached from `devel` so that merging does
not silently restart it and resume billing. Restarting it is a two-step
operation; see below.

### Resuming the demo

```bash
git push origin devel:demo     # the existing connection does the rest
```

### Resuming the devel instance

```bash
railway service source connect --repo jonhanke-nam/PsyNeuView \
  --branch devel --service psyneuview-devel
railway up --service auth-devel --detach
```

The proxy needs a nudge because stopping it left no deployment to restart;
reconnecting the app's source only revives the app.

### Stopping them again

Disconnect the source **first**, then remove the deployment. Doing it the other
way round means Railway rebuilds from the branch the moment the deployment
disappears — which is what happened the first time, and it takes two attempts
to notice:

```bash
railway service source disconnect --service <app-service>
railway down --service <app-service> --yes
railway down --service <proxy-service> --yes
```

## What deploys where

*(the mapping below applies when the instances are running)*

| Push this | Deploys to | When | Audience |
|---|---|---|---|
| `devel` | the devel instance | automatically, on every merge | maintainers |
| `demo` | the demo instance | automatically, when the branch moves | invited collaborators |

**Deployment keys off branches, never tags.** Release tags exist — `make
release-tag` cuts them (#1073) — but no workflow and neither Railway service
triggers on one. Both services watch a *branch* and redeploy when it moves, so
tagging a release does not deploy anything. The difference between the two instances
is not the mechanism, it is *who moves the branch*: `devel` moves whenever a PR
merges, and `demo` moves only when somebody decides to publish:

```bash
git push origin devel:demo     # publish the current trunk to the demo
```

So "auto-deploy" is true of both — the demo simply has a branch that does not
move on its own. That is the whole design: a collaborator should not get a 502 because an
unrelated PR merged.

**Neither is built from GHCR.** The `container-image` workflow publishes an
image to GHCR on `devel` pushes, but Railway builds the `Dockerfile` from the
repo itself. The published image is for the Princeton VM (#1063), not for
these.

## Who can reach the hosted instances

Both Railway instances sit behind an oauth2-proxy that requires GitHub sign-in
and admits a named allowlist. **The allowlist is the entire access boundary** —
Railway provides no access control of its own, and the app has no concept of a
user, so nothing else stands between a visitor and a server that executes
Python by design.

Currently admitted to **both** instances: the maintainer and two invited
collaborators. The list itself lives in the proxy's configuration (see
"Changing the list" below), not in this repository.

Anyone else can reach the sign-in page and authorize on GitHub's side, then is
refused by the proxy. The gate covers `/api/*` as well as the UI — a proxy that
protected only the HTML would leave `/api/model/load` open, which is the
endpoint that runs Python.

### Changing the list

```bash
railway variables --service auth       --set "OAUTH2_PROXY_GITHUB_USERS=a,b,c"   # demo
railway variables --service auth-devel --set "OAUTH2_PROXY_GITHUB_USERS=a,b,c"   # devel
```

The two are set independently and currently happen to match. Use each person's
**canonical** GitHub login — `gh api users/<name> -q .login` returns it. A wrong
entry fails closed, which is the safe direction, but it is still wrong and the
symptom is a colleague who cannot sign in for no visible reason.

For more than a handful of people, oauth2-proxy can key off a GitHub org or
team (`OAUTH2_PROXY_GITHUB_ORG` / `_TEAM`) so access follows membership instead
of a list someone has to remember to edit.

### Not verified

That a **non-allowlisted** user is actually refused has been confirmed from
configuration only, never by attempting it — that needs a second GitHub
account. Worth doing from a private window before either URL is shared any
wider than these three.

## Railway — demo instance

**Temporary, but the stable one of the two.** Stood up to show the tool without
an install (#895); expected to be torn down or superseded by a Princeton VM
(#1076). This is the instance to send people to — the devel instance below
breaks by design.

| | |
|---|---|
| Endpoint | the demo instance |
| Account | the maintainer's Railway account |
| Workspace | the maintainer's projects |
| Project | `psyneuview-demo` |
| Region | `sfo` |
| Access | GitHub sign-in, allowlist (see above) |
| Storage | 500 MB volume at `/home/pnv` |
| Source | An **upload**, not a GitHub connection — see "Updating" below |
| Dashboard | the Railway project's dashboard (link kept with the deployment's maintainers) |

### Shape

Two services. `psyneuview` runs the app and has **no public domain** — it is
reachable only on Railway's private network. `auth` runs oauth2-proxy, holds
the domain, and is the entire access boundary.

Rebuild instructions, including the gotchas, are in
[deploying](deploying.md#rebuilding-the-deployment-from-scratch).

### Updating — it tracks `demo`, deliberately

The service is connected to this repository and redeploys when the **`demo`**
branch moves:

```
source: github("jonhanke-nam/PsyNeuView", { branch: "demo" })
```

`demo` is not a development branch. It exists so that deploying is a decision
rather than a side effect of merging. To publish the current trunk:

```bash
git push origin devel:demo
```

That makes "what is the demo running?" a question `git log demo` answers, and
makes rolling back a push rather than a dashboard operation.

**Why not track `devel`.** It did, briefly, and every merge redeployed — which
means a ~20-30 second outage each time (see below), landing on whoever happened
to be using it. A demo someone else relies on should not move because an
unrelated PR merged.

**Develop locally, not here.** The container runs under Podman on a laptop with
a much faster loop than a Railway build, and full log access. This instance
exists so people *without* a checkout can see the app; that is not a need the
maintainer has. If a work-in-progress does need a URL, create a separate Railway
*environment* for it rather than pointing this one at a branch — separate
services, separate volume, deleted when finished.

It was not always so. The service was first created with `railway up`, which
uploads a directory and builds from that snapshot — no connection to the repo,
so merges never reached it. The instance sat three merges behind, including the
two fixes most relevant to using it remotely (#1069, #1070), and the drift
surfaced only because someone asked why a menu entry was missing. Worth
recording, because an uploaded service looks identical to a connected one until
you go looking.

**`checkSuites` is off**, so a push to `demo` deploys regardless of whether CI
passed on that commit. Less pressing now that publishing is deliberate — you
would be pushing something you had already decided was good — but Railway's
"Wait for CI" setting is there if this instance ever matters more.

**Redeploys are never zero-downtime.** A volume can only be mounted by one
container at a time, so Railway stops the old one before starting the new: about
20-30 seconds of 502 from the proxy, most of it PsyNeuLink pre-warming. No
healthcheck setting changes this — Railway's own documentation says so
explicitly. It is a reason to publish deliberately, not a bug to fix.

To deploy something that is not on `demo` at all — a branch under test, say —
upload it directly:

```bash
railway up --service psyneuview --detach
```

Note the CLI resolves the project from the **directory** it runs in, not from
your account, so that must be run from a directory linked with `railway link`.

### Cost while paused

Compute billing stops when the containers do — memory was the whole bill
(`Memory $0.215` of a $0.217 day, against `CPU $0.0014` and `Volume $0.0002`).
Paused, the only live line item is volume storage at roughly **7 cents a
month** for both.

Railway bills compute **continuously while a container runs**, regardless of
traffic — there is no scale-to-zero or app-sleeping. An idle instance costs the
same as a busy one, which is why pausing means stopping, not leaving it up.

### The volumes have a deletion date

> Railway deletes stateful volumes created by Trial accounts **30 days after
> the expiration of your credits**.

Both volumes were created under the trial. Trial credits expire around
**mid-October 2026**, so the volumes go around **mid-November** unless the
workspace is upgraded (#1078).

At 32 MB each of largely scratch data that is a small loss today. It stops
being small if anyone saves real work to an instance and assumes it persists.
It is also a second, independent reason the Free tier is not somewhere to rest:
0.5 GB per service cannot run the app *and* the storage goes away.

### Plan, and why it has an expiry date

The workspace is on Railway's **Free Trial**: a one-time $5 credit, 30 days,
and per-service limits of 2 vCPU / 1 GB RAM. The observed limits match that
tier exactly.

Two consequences worth planning around:

- **The trial runs out.** It began 2026-09-15, so it lapses around mid-October.
- **The tier it would fall back to cannot run this app.** Railway's Free tier
  gives 1 vCPU / 0.5 GB, and the app is already using ~911 MB. The demo does
  not degrade when the trial ends — it stops working.

| Plan | Price | Credit | Per-service |
|---|---|---|---|
| Free Trial | $0 | $5 once, 30 days | 2 vCPU / 1 GB — **current** |
| Free | $0 | $1/mo | 1 vCPU / 0.5 GB — too small for this app |
| Hobby | $5/mo | $5/mo | 48 vCPU / 48 GB |
| Pro | $20/mo | $20/mo | 1,000 vCPU / 1 TB |

Hobby is the tier that fits if this instance should outlive the trial: it
removes the memory ceiling with a wide margin, and its monthly credit more than
covers actual consumption.

### Resource use — watch the memory

| Service | Memory | CPU |
|---|---|---|
| `psyneuview` | **911 MB / 1024 MB** | < 0.01 / 2.0 vCPU |
| `auth` | 42 MB / 1024 MB | < 0.01 / 2.0 vCPU |

The app sits at roughly **89% of its ceiling** with a model loaded and nothing
running — well above the ~620 MB CI measured against a small demo model. A
large reference model or a PyTorch training run has very little room before it
is killed, and an out-of-memory kill mid-run gives no useful error.

If the instance starts dying during runs, this is the cause, and the fix is the
plan rather than the application.

### Cost

Usage-based and negligible at this size: **$0.014** in the first period, mostly
memory, with CPU, egress and volume rounding to nothing.

**Spend limits cannot be set on this plan** — `railway usage limit set` reports
that usage limits require an active subscription. That is less exposure than it
sounds, since a trial has no attached spend, but it also means the guard rail
only becomes available on a paid plan.

### Known limits of this instance

- **One shared workspace.** Everyone on the allowlist shares a filesystem, a
  PsyNeuLink worker, and each other's saved models. See
  [the hosted-instance guide](guides/hosted-instance.md).
- **Not backed up.** The volume survives redeploys; nothing survives the
  project being deleted.
- **PsyNeuLink version is fixed** by the image.

## Railway — devel instance

**Unstable by design.** Tracks `devel` and redeploys on every merge, so that
merged work can be looked at in a browser without disturbing the demo (#1085).

| | |
|---|---|
| Endpoint | the devel instance |
| Branch | `devel` — **auto-deploys on merge** |
| Audience | maintainers; see the access list above |
| Services | `psyneuview-devel` (no public domain) + `auth-devel` (holds it) |
| Volume | `psyneuview-devel-volume` — **separate** from the demo's |
| Dashboard | the Railway project's dashboard (link kept with the deployment's maintainers) |

Same shape as the demo in every respect but two: the branch it follows, and the
fact that nobody should rely on it. If the entries below ever describe
different *architectures*, something has drifted and one of them is wrong.

### Why it exists

The demo publishes deliberately from `demo`, which is right for an instance
someone else depends on and leaves nowhere to look at merged-but-unpublished
work.

Local Podman is the faster loop for development and remains the right tool for
it. This instance is for the things a laptop cannot reproduce: WebSocket
upgrades through a proxy, the identity header that presence depends on (#1082),
and `container` deployment mode behaving as intended. Every one of those has
caused a real problem that only appeared once deployed.

### Expect it to break

It runs whatever last merged. A change that is green in CI can still be wrong
in a browser, and this is where that shows up — that is the point of it, not a
defect. **Do not send anyone here who needs it to work**; send them to the demo.

### Separate volume, deliberately

Sharing the demo's volume would let a broken `devel` corrupt models someone
else is relying on. The two instances share an OAuth app and an access list,
and nothing else.

## Princeton VM — planned

Not yet provisioned. Tracked in #1076 (the OIT request) with the per-user
provisioning pattern in #1074. This is intended to be the durable home: one
container per person, Apache with TLS in front, rootless podman under an
unprivileged service account.

## Adding an instance here

One section per hosted instance, with at minimum: endpoint, owning account,
what it costs, who can reach it, where the rebuild instructions are, and
whether it is temporary. Split this file into `docs/deployments/` once it
carries more than three or four.
