# PsyNeuView container image (#1063).
#
# One OCI image serves two runtimes. Docker runs it directly; Apptainer
# converts from it, so there is no second recipe to keep in sync:
#
#   docker build -t psyneuview:dev .
#   apptainer build psyneuview.sif docker-daemon://psyneuview:dev
#
# The backend serves the built SPA itself (app.main mounts frontend/dist at
# "/"), so this is a single process on a single port — no nginx, and nothing to
# orchestrate for one user.
#
# This image is one user, one process. It is NOT multi-tenant: model routes
# still take absolute paths and running a model is `exec` by design, so the
# container is the isolation boundary and each user needs their own.

# ── Stage 1: build the SPA ───────────────────────────────────────────────
# Node version tracks NODE_VERSION in .github/workflows/e2e.yml.
FROM node:22-slim AS frontend

WORKDIR /build
# Manifests first, so `npm ci` caches independently of source edits.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# ── Stage 2: runtime ─────────────────────────────────────────────────────
# Python version tracks PYTHON_VERSION in .github/workflows/backend-tests.yml.
FROM python:3.13-slim AS runtime

# PsyNeuLink is pinned to the exact ref CI tests against, so "the tests passed"
# says something about *this image*. Keep in step with PSYNEULINK_GIT_REF in
# .github/workflows/backend-tests.yml.
ARG PSYNEULINK_GIT_REF=b0a750db14f0e18f13f4af6d4228e5824a7f2797
ARG PSYNEULINK_REPO=https://github.com/PrincetonUniversity/PsyNeuLink.git

# git: pip needs it to resolve the VCS pin above.
# libgomp1: torch's OpenMP runtime, absent from -slim.
RUN apt-get update \
    && apt-get install --no-install-recommends -y git libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch. The default Linux wheel bundles CUDA libraries and costs
# several GB for a deployment that will never see a GPU.
ENV PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu

WORKDIR /app

# Dependencies as their own layer, keyed on pyproject alone: it changes far
# less often than app source, and this is the expensive layer by a wide margin.
# The package itself is installed from real source further down — a stub here
# would be what ends up in site-packages.
COPY backend/pyproject.toml ./backend/
RUN mkdir -p backend/app && touch backend/app/__init__.py \
    && pip install --no-cache-dir "git+${PSYNEULINK_REPO}@${PSYNEULINK_GIT_REF}" \
    && pip install --no-cache-dir ./backend \
    && pip uninstall -y psynewview

COPY backend/ ./backend/
# --no-deps: everything is already resolved above. Editable so the installed
# distribution points at the source copied on the line before.
RUN pip install --no-cache-dir --no-deps -e ./backend

# app.main resolves the SPA as <main.py>/../../../frontend/dist, so the repo's
# directory shape has to survive into the image.
COPY --from=frontend /build/dist ./frontend/dist

# A non-root user with a real home: every piece of per-user state
# (~/.psynewview.json, ~/.psyneuview/sources, bundles) is Path.home()-relative.
# Mount a volume at /home/pnv to persist a user's work. Under Apptainer this
# path is the invoking user's actual home, which is what makes per-user
# separation fall out of the runtime rather than needing app changes.
RUN useradd --create-home --uid 1000 pnv && chown -R pnv:pnv /app
USER pnv
ENV HOME=/home/pnv

# Saved and imported models must land on the mounted volume, not in the image.
# The default is <repo>/models — inside the image layer here, so a user's work
# would vanish on redeploy, and under Apptainer's read-only image the mkdir
# would fail outright. (The env var predates the PSYNEUVIEW_ spelling.)
ENV PSYNEWVIEW_MODELS_DIR=/home/pnv/models
RUN mkdir -p /home/pnv/models

# Declared, not inferred (#1062). Without this the backend defaults to `local`
# and offers pip installs into an image whose venv may be read-only.
ENV PSYNEUVIEW_DEPLOYMENT_MODE=container \
    PORT=8000 \
    HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1

# Apptainer has no port mapping — the process binds a host port directly — so
# the port must be settable at run time rather than baked in.
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT','8000') + '/health').read()"]

WORKDIR /app/backend
# Shell form so $PORT and $HOST expand.
#
# HOST is settable because the right address depends on the platform, and the
# two common cases are mutually exclusive:
#
#   * Docker/Podman publish a port to the container's *IPv4* address, so a
#     process bound only to `::` never sees those connections — the container
#     starts cleanly and then fails every health check.
#   * Some platforms route service-to-service traffic over IPv6 only (Railway's
#     private network does), where `0.0.0.0` is unreachable and an auth proxy
#     in front reports a 502 it cannot explain.
#
# 0.0.0.0 is the default because published-port mapping is the common case.
# Deployments on an IPv6-only private network must set `HOST=::`; see
# docs/deploying.md.
#
# Binding all interfaces is correct *inside* a container: the container
# boundary is what limits reach, and an Apptainer user binds a port they
# already own. Do not publish it to a public interface without an auth gateway
# in front — see docs/deploying.md.
CMD python -m uvicorn app.main:app --host ${HOST} --port ${PORT}
