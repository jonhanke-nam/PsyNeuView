# Deploying PsyNeuView

One container image serves every deployment target. `docker build` produces it,
Podman and Railway run it directly, and Apptainer converts from it — there is no
second recipe to keep in step.

Read [deployment modes](deployment-modes.md) first: the image declares
`PSYNEUVIEW_DEPLOYMENT_MODE=container`, which is what turns off pip installs and
the host's GitHub credentials.

## The rule that governs every target

**One container per user.** Running a model executes the user's Python on the
server — that is what PsyNeuView does, not a flaw in it. So the container is the
security boundary, and two people sharing one container share a filesystem, a
PsyNeuLink worker, and each other's models.

A deployment therefore needs two things the image cannot provide for itself:

1. **Authentication in front of it.** The app has no user accounts. Anything
   reachable without an auth layer is remote code execution offered to whoever
   finds the URL.
2. **A container per person**, with its own volume mounted at `/home/pnv` —
   every piece of per-user state (`~/.psynewview.json`, `~/.psyneuview/sources`,
   saved bundles) is relative to the home directory.

This is the JupyterHub model, and it is sound for named collaborators. It is not
suitable for anonymous signup. Multi-tenancy in a single container is tracked
separately in
[#1058](https://github.com/jonhanke-nam/PsyNeuView/issues/1058).

## Building

```bash
docker build -t psyneuview:dev .
```

PsyNeuLink is pinned by `ARG PSYNEULINK_GIT_REF` to the same commit the test
workflows use, and CI fails the build if the two drift — otherwise "the tests
passed" would say nothing about the image that ships.

CI builds this on every PR touching `backend/`, `frontend/`, or the Dockerfile,
runs a container, and asserts it serves the SPA, loads a real model, and is
actually in container mode.

### Measured footprint

From the CI smoke run (amd64, one container, one small demo model loaded):

| Measure | Value |
|---|---|
| Image size, uncompressed | **2.1 GB** |
| Container memory, model loaded | **≈620 MB** |
| Time to healthy from cold start | ≈20 s |

The memory figure is a baseline — a three-mechanism demo, loaded and
introspected, with no run in flight. A large reference model or a PyTorch
training run will be materially higher, and that peak has not been measured yet.
Size a host on the baseline plus honest headroom, not on the baseline alone.

## Podman on a managed Linux VM

The target Princeton OIT provides: RHEL, Apache with TLS in front, services run
by an unprivileged account, no local root.

The image is built for that — it runs as a non-root user (uid 1000) and binds a
configurable high port, so rootless Podman needs no special handling.

```bash
podman run -d --name psyneuview-alice \
  --userns=keep-id \
  -v ~/psyneuview-homes/alice:/home/pnv \
  -p 8801:8000 \
  ghcr.io/jonhanke-nam/psyneuview:devel
```

`--userns=keep-id` matters: without it a rootless bind mount lands with the
wrong ownership and the container cannot write its own home.

For containers that survive reboots and update themselves, use Podman's systemd
integration (Quadlet) with `podman auto-update`, so the VM pulls new images
rather than anything needing to reach in.

### Apache

Terminate TLS at Apache and proxy to each user's port. **The WebSocket rule is
not optional:**

```apache
ProxyPass        /ws  ws://127.0.0.1:8801/ws
ProxyPassReverse /ws  ws://127.0.0.1:8801/ws
ProxyPass        /    http://127.0.0.1:8801/
ProxyPassReverse /    http://127.0.0.1:8801/
```

The app opens a WebSocket at `/ws` to notice when a model file changes on disk.
A config that proxies only HTTP works well enough to look correct, and then the
app silently stops reacting to external edits — a symptom nobody traces back to
the proxy.

## Apptainer (HPC and shared hosts)

Apptainer runs as the invoking user with no daemon and no root, which is what
makes it acceptable on clusters where Podman and Docker are not.

```bash
apptainer build psyneuview.sif docker://ghcr.io/jonhanke-nam/psyneuview:devel
PORT=8801 apptainer run --cleanenv --env PORT=8801 psyneuview.sif
```

Two differences from the container runtimes:

- **`$HOME` is the invoking user's real home**, so per-user separation comes
  from the OS rather than from volume mounts. This is why Apptainer needs none
  of the multi-tenancy work — it is N single-user processes, not one shared
  service.
- **There is no port mapping.** The process binds a host port directly, so the
  port must be above 1024 and distinct per concurrent user on a host.

The image is read-only under Apptainer. That is the intended shape: the
PsyNeuLink version is fixed by the image, which is what makes a deployment
reproducible.

## Railway

Railway builds the Dockerfile and runs the container, so it is the same image.
`railway.toml` carries the configuration; Railway injects `PORT` and the
Dockerfile's `CMD` already honors it.

Good for a **single-user demo** — the zero-install "open a URL and look at it"
surface, with no VM to administer.

Set up:

1. Point a Railway service at the repo; it detects the Dockerfile.
2. Attach a **volume mounted at `/home/pnv`**, or the user's models and
   settings vanish on every redeploy.
3. Give the service enough memory. PyTorch and PsyNeuLink are the floor, not
   the app itself — budget several GB and watch the first run.
4. **Put an access layer in front before sharing the URL.** Railway provides
   none. An unauthenticated Railway URL is a public Python execution service.

Do not raise the replica count. All state is on the instance's disk, so N
replicas means users landing on a random one of N unrelated workspaces.

### Authentication: two services, not one

Railway has no built-in access control, so the app service must never hold the
public domain. Put an OAuth proxy in front and keep the app private:

```
browser ──TLS──▶ auth (oauth2-proxy)        ──▶ psyneuview
                 public domain                  no public domain
                 GitHub OAuth                   psyneuview.railway.internal:8000
```

- **`psyneuview`** — builds this repo's Dockerfile. **Remove its public
  domain.** It stays reachable inside the project over Railway's private
  network.
- **`auth`** — the `quay.io/oauth2-proxy/oauth2-proxy` image, holding the
  public domain, with `--upstream=http://psyneuview.railway.internal:8000`.

GitHub is the natural provider: collaborators already have accounts, and
`--github-user` restricts access to a named allowlist, which is the right shape
for an invite-only demo.

Two details that will otherwise cost an afternoon:

- **Set `HOST=::` on the app service.** Railway's private network is IPv6-only,
  and a service bound to `0.0.0.0` is invisible to the proxy — the symptom is a
  502 that looks like the app crashed. The image cannot default to this: Docker
  and Podman publish ports to the container's IPv4 address, where binding only
  `::` fails every health check instead. The two cases are mutually exclusive,
  so the platform that needs IPv6 declares it.
- **Pin `PORT` on the app service.** Railway injects its own, so the proxy's
  upstream port is otherwise a guess.
- **WebSockets must survive the proxy.** The app opens `/ws` for external-edit
  detection. Confirm it upgrades through oauth2-proxy — if it doesn't, the app
  looks fine and silently stops noticing file changes, exactly as with a
  misconfigured Apache (see above).

The proxy is the whole security boundary here. An `auth` service misconfigured
to allow any GitHub user is the same as no auth at all, since running a model
executes Python on the server.

### Rebuilding the deployment from scratch

The topology is two services, a volume and a set of variables, all created
through the CLI. That would otherwise live only in someone's shell history, so
it is written down here.

Railway's own infrastructure-as-code (`.railway/railway.ts`) would capture this
more rigorously, but it requires an SDK installed from the repository root —
and this repo has no root Node project. While the instance is a temporary demo
that is not worth a repo-structure change; see
[#1072](https://github.com/jonhanke-nam/PsyNeuView/issues/1072) for the
decision and the deprecation deadline.

**The project link is per-directory.** `railway` commands resolve the project
from the directory you run them in, not from your account, so run these from a
checkout of this repo.

```bash
railway login
railway init --name psyneuview-demo
```

**1. The proxy service, and its domain first.** The domain is needed before the
GitHub OAuth app can be registered, because it determines the callback URL.

```bash
railway add --service auth --image quay.io/oauth2-proxy/oauth2-proxy:latest
railway domain --service auth            # prints the public URL
```

Renaming that domain later is `railway domain update <id> --domain <label>`.
It is a **rename, not an alias** — the previous hostname stops resolving, so
anyone holding the old link loses it. A second `*.up.railway.app` name cannot be
added alongside: Railway accepts it as a *custom* domain and then asks for a
CNAME inside the `railway.app` zone, which only Railway can create, so it never
verifies and serves 404. Use a domain you control if you need two names to work
at once.

Either way, changing the hostname means updating the OAuth callback in **two**
places — `OAUTH2_PROXY_REDIRECT_URL` and the GitHub app's Redirect URI. Miss
the second and sign-in fails with a redirect-URI mismatch that reads like a
GitHub fault.

**2. Register a GitHub OAuth app** at Settings → Developer settings → OAuth
Apps. Redirect URI is `https://<that-domain>/oauth2/callback`, exactly. Leave
wildcard matching **off** — it would let tokens reach other paths and
subdomains, which is the last thing to loosen on the gateway guarding code
execution. Keep the client ID and secret for step 5.

**3. The app service.** Note what is *absent*: it never gets a domain. That is
the access boundary — the app is reachable only on the private network, with
the proxy as the sole way in.

```bash
railway add --service psyneuview
railway up --service psyneuview --detach

# Railway injects its own PORT, so the proxy's upstream would otherwise be a
# guess. HOST must be IPv6: Railway's private network is v6-only and the image
# defaults to 0.0.0.0, which is correct everywhere else and unreachable here.
railway variables --service psyneuview --set "PORT=8000" --set "HOST=::"
```

**4. Persistent storage.** Without this, every redeploy discards saved and
imported models.

```bash
# This subcommand wants a service *ID*, not a name — passing a name crashes
# the CLI. Take the ID from the service URL in the dashboard or a build log.
railway volume --service <SERVICE_ID> add --mount-path /home/pnv
```

**5. Proxy configuration.** Generate a fresh cookie secret; never reuse one.

```bash
COOKIE=$(python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())")

railway variables --service auth \
  --set "OAUTH2_PROXY_PROVIDER=github" \
  --set "OAUTH2_PROXY_UPSTREAMS=http://psyneuview.railway.internal:8000" \
  --set "OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180" \
  --set "PORT=4180" \
  --set "OAUTH2_PROXY_REDIRECT_URL=https://<domain>/oauth2/callback" \
  --set "OAUTH2_PROXY_EMAIL_DOMAINS=*" \
  --set "OAUTH2_PROXY_GITHUB_USERS=user1,user2" \
  --set "OAUTH2_PROXY_REVERSE_PROXY=true" \
  --set "OAUTH2_PROXY_COOKIE_SECURE=true" \
  --set "OAUTH2_PROXY_PROXY_WEBSOCKETS=true" \
  --set "OAUTH2_PROXY_COOKIE_SECRET=${COOKIE}" \
  --set "OAUTH2_PROXY_CLIENT_ID=<id>" \
  --set "OAUTH2_PROXY_CLIENT_SECRET=<secret>"
```

`OAUTH2_PROXY_GITHUB_USERS` is the entire access list. GitHub logins are
compared as given, so use the canonical spelling — `gh api users/<name> -q
.login` returns it. A wrong entry fails closed (that person cannot sign in),
which is the safe direction, but it is still wrong.

**6. Verify, rather than assume.** The failure that matters is a proxy that
gates the HTML and leaves the API open, since `/api/model/load` executes Python
server-side:

```bash
curl -so /dev/null -w "%{http_code}\n" https://<domain>/                     # expect 403
curl -so /dev/null -w "%{http_code}\n" https://<domain>/api/settings/info    # expect 403
```

Then sign in and confirm the WebSocket: the app service log should show
`"WebSocket /ws" [accepted]` from a private-network address. Without it the app
looks healthy and silently stops noticing external file edits.

Two things this recipe cannot verify for you: that a **non-allowlisted** user is
actually refused (needs a second GitHub account), and that the volume is
writable by the container's non-root user (save something, redeploy, confirm it
survived).

## Vercel — not a supported target

Vercel cannot run this application, and the reasons are structural rather than
a matter of configuration:

- **No long-lived process.** Vercel runs functions per request. PsyNeuView
  keeps a warm PsyNeuLink worker between requests, and a WebSocket open for the
  file watcher.
- **No persistent filesystem.** Every model, sidecar and setting the app writes
  is a file. Vercel's filesystem is ephemeral and per-invocation.
- **Function size.** PyTorch alone is larger than a Vercel function bundle is
  permitted to be.

Vercel could host the built SPA, but the backend already serves it from the
same origin, so splitting them adds a deployment to maintain and removes
nothing. If a managed platform is wanted, Railway is the one that fits.

## Getting files in and out

A container has no access to your laptop's disk, so **Open from path…** — the
primary way models load locally — only reaches files that are already inside the
container: the bundled demos and reference models. Everything else moves through
one of the routes below. (Replacing path-based opening with a workspace browser
is [#1058](https://github.com/jonhanke-nam/PsyNeuView/issues/1058).)

### The transfer format

`.pnlproject` is a zip carrying a manifest, `model.py`, the saved layout, and an
MDF mirror when the model serializes cleanly. It round-trips: what you export
from one instance imports into another.

| Direction | How | Endpoint |
|---|---|---|
| Out | **Export project** — downloads a `.pnlproject` through the browser | `POST /api/model/export-project` |
| Out | **Export MDF** — downloads a YAML/JSON MDF | `POST /api/model/export-mdf` |
| In | **Import project** — uploads a `.pnlproject` | `POST /api/model/import-project` |
| In | **Import MDF** | `POST /api/model/import-mdf` |
| In | **Load from GitHub** — any public repo, by ref and path | `GET /api/model/github/file` |

Downloads and uploads both go through the browser, so they work identically
against a remote container and a local one — no shell access needed.

### Where uploads land

Imported and saved models are written to `PSYNEWVIEW_MODELS_DIR`, which the
image sets to `/home/pnv/models` — **on the mounted volume**. Without that the
default would be `<repo>/models` inside the image layer, and a redeploy would
discard a user's work silently. CI asserts the save directory resolves under
`/home/pnv` for exactly that reason.

So: mount a volume at `/home/pnv`, or accept that everything is scratch.

### Bulk transfer, per runtime

- **Local Podman/Docker** — bind-mount a host directory instead of a named
  volume and drop `.py` files straight in:
  `-v ~/my-models:/home/pnv/models`.
- **Apptainer** — `$HOME` is already the user's real home. Their files are
  simply there; nothing to transfer.
- **Princeton VM** — the per-user volume lives on the VM, so a maintainer can
  stage files into it over SSH. Users themselves use upload/export.
- **Railway** — no filesystem access at all. Upload and export through the
  browser, or load from GitHub. `railway run` can reach the container for
  one-off inspection.

### Practical advice

For anything you want to keep, **GitHub is the better channel**: commit the
model, load it by URL, and the container stays disposable. Treat the volume as a
working copy rather than a system of record — it is not backed up, and a
container per user means there is no shared place for a "final" version to live.

## Choosing a target

| | Princeton VM (Podman) | Apptainer | Railway |
|---|---|---|---|
| Users | several, one container each | several, one process each | one |
| Authentication | Apache, in front | network / SSH tunnel | must be added |
| Who administers | OIT provides the VM, we run the service | the user, per session | nobody |
| Persistence | volume per user | the user's real home | volume, must be attached |
| Best for | the real home | clusters, and anyone with an HPC account | demos and a quick look |
