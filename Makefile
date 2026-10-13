# PsyNewView Makefile
# One-command setup and launch for the PsyNeuLink visual editor.
#
# Multi-branch testing:
#   Each branch can run on its own port pair. Set SLOT=1,2,3... to offset:
#     make dev SLOT=1   →  backend :8001, frontend :5174, open http://localhost:5174
#     make dev SLOT=2   →  backend :8002, frontend :5175, open http://localhost:5175
#   Default SLOT=0 uses the standard ports (8000 / 5173).
#   Or set ports explicitly:  make dev PORT=9000 FRONTEND_PORT=9100

SHELL := /bin/bash
VENV_DIR ?= backend/.venv
# PsyNeuView needs Python 3.12, 3.13, or 3.14 — kept in sync with
# backend/pyproject.toml's requires-python = ">=3.12,<3.15". The venv target
# checks this and names a usable interpreter if the one you gave it is out
# of range:  make install PYTHON=python3.14
PYTHON ?= python3
# Interpreters to suggest when $(PYTHON) is out of range, newest first.
PYTHON_SUPPORTED := python3.14 python3.13 python3.12
PIP := $(VENV_DIR)/bin/pip
PYTHON_VENV := $(VENV_DIR)/bin/python
PSYNEULINK_DIR ?= ../PsyNeuLink

# Port configuration — SLOT provides a simple offset for parallel branches
SLOT ?= 0
PORT ?= $(shell echo $$((8000 + $(SLOT))))
FRONTEND_PORT ?= $(shell echo $$((5173 + $(SLOT))))

.PHONY: release-tag help venv install install-pnl install-all install-frontend \
        backend frontend start stop dev dev-bg test \
        clean-venv clean-frontend clean info status \
        checkout-release back-to-devel run-release run-devel \
        release-pdfs

help: ## Show this help message
	@echo "PsyNewView Development Makefile"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  %-20s %s\n", $$1, $$2}'
	@echo ""
	@echo "Configuration:"
	@echo "  VENV_DIR=$(VENV_DIR)          (override with: make VENV_DIR=path <target>)"
	@echo "  PYTHON=$(PYTHON)              (requires python3.12, python3.13, or python3.14)"
	@echo "                                (override with: make <target> PYTHON=python3.14)"
	@echo "  PSYNEULINK_DIR=$(PSYNEULINK_DIR)  (override with: make PSYNEULINK_DIR=path <target>)"
	@echo ""
	@echo "Port configuration:"
	@echo "  SLOT=$(SLOT)  →  backend :$(PORT), frontend :$(FRONTEND_PORT)"
	@echo "  Quick:     make dev SLOT=1       (backend :8001, frontend :5174)"
	@echo "  Explicit:  make dev PORT=9000 FRONTEND_PORT=9100"

# --- Virtual environment ---

venv: $(VENV_DIR)/bin/activate

$(VENV_DIR)/bin/activate:
	@v=$$($(PYTHON) -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null); \
	if [ -z "$$v" ]; then \
		printf '\nerror: %s was not found on your PATH.\n\n' '$(PYTHON)'; \
		printf 'Install Python 3.14:  brew install python@3.14\n'; \
		printf 'then re-run:          make install PYTHON=python3.14\n\n'; \
		exit 1; \
	fi; \
	if [ "$$v" -lt 312 ] || [ "$$v" -ge 315 ]; then \
		printf '\nerror: %s is Python %s.%s — PsyNeuView needs 3.12, 3.13, or 3.14.\n' \
			'$(PYTHON)' "$$(($$v / 100))" "$$(($$v % 100))"; \
		printf '(backend/pyproject.toml: requires-python = ">=3.12,<3.15")\n\n'; \
		found=; \
		for c in $(PYTHON_SUPPORTED); do \
			if command -v $$c >/dev/null 2>&1; then found=$$c; break; fi; \
		done; \
		if [ -n "$$found" ]; then \
			printf 'Found %s already installed — re-run with:\n' "$$found"; \
			printf '  make install PYTHON=%s\n\n' "$$found"; \
		else \
			printf 'Install one:  brew install python@3.14\n'; \
			printf 'then re-run:  make install PYTHON=python3.14\n\n'; \
		fi; \
		exit 1; \
	fi
	$(PYTHON) -m venv $(VENV_DIR)
	$(PIP) install --upgrade pip setuptools wheel
	@echo ""
	@echo "Virtual environment created at $(VENV_DIR)"

# --- Installation targets ---

install: venv ## Install backend (editable) + its declared deps from pyproject.toml
	$(PIP) install --quiet -e backend/

install-pnl: venv ## Install PsyNeuLink from local repo (editable)
	$(PIP) install --quiet -e "$(PSYNEULINK_DIR)"

install-all: venv ## Install local PsyNeuLink (editable) + backend (editable)
	$(PIP) install --quiet -e "$(PSYNEULINK_DIR)"
	$(PIP) install --quiet -e backend/

# Reinstall when the lockfile content changes (survives branch switches, where
# mtime is unreliable) OR when the install is incomplete. Gate on the vite
# binary, not the node_modules/ directory: an empty or partially-installed
# node_modules/ (e.g. an interrupted install) still satisfies a directory test,
# so `npm install` would be skipped and `vite` would later fail with
# "command not found".
install-frontend: ## Install frontend deps; reinstall when the lockfile changes or the install is incomplete
	@cd frontend && \
	want=$$( (shasum package-lock.json 2>/dev/null || sha1sum package-lock.json 2>/dev/null) | cut -d' ' -f1); \
	have=$$(cat node_modules/.deps-hash 2>/dev/null || echo none); \
	if [ ! -x node_modules/.bin/vite ] || [ "$$want" != "$$have" ]; then \
		echo "Frontend deps changed — running npm install..."; \
		npm install; \
		rm -rf node_modules/.vite; \
		: > node_modules/.vite-restart-needed; \
		printf '%s\n' "$$want" > node_modules/.deps-hash; \
	fi

# --- Running ---

# --reload-dir app constrains uvicorn's file watcher to the source tree, so
# pip-install activity in backend/.venv/ doesn't trigger a worker reload
# mid-install (which otherwise wipes the in-memory install_manager state
# and leaves the frontend polling a dead job id forever).
backend: install ## Start the backend server (PORT=8000, or set SLOT/PORT)
	@pid=$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		is_ours=false; \
		check_pid=$$pid; \
		while [ "$$check_pid" != "1" ] && [ -n "$$check_pid" ]; do \
			if ps -o command= -p $$check_pid 2>/dev/null | grep -q uvicorn; then \
				is_ours=true; break; \
			fi; \
			check_pid=$$(ps -o ppid= -p $$check_pid 2>/dev/null | tr -d ' '); \
		done; \
		echo ""; \
		if $$is_ours; then \
			echo "PsyNewView backend is already running on port $(PORT)."; \
			echo ""; \
			echo "  Nothing to do — open http://localhost:$(PORT)/docs"; \
			echo "  To restart:  kill $$pid && make backend PORT=$(PORT)"; \
		else \
			proc=$$(ps -o command= -p $$pid 2>/dev/null || echo "unknown"); \
			echo "Port $(PORT) is in use by another process (pid $$pid):"; \
			echo "  $$proc"; \
			echo ""; \
			echo "  To free it:  kill $$pid"; \
			echo "  To use another port:  make backend PORT=8001"; \
		fi; \
		echo ""; \
		exit 1; \
	fi
	cd backend && $(realpath $(VENV_DIR))/bin/uvicorn app.main:app --port $(PORT) --reload --reload-dir app

frontend: install-frontend ## Start the frontend dev server (FRONTEND_PORT=5173, or set SLOT)
	@pid=$$(lsof -tiTCP:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		is_ours=false; \
		check_pid=$$pid; \
		while [ "$$check_pid" != "1" ] && [ -n "$$check_pid" ]; do \
			if ps -o command= -p $$check_pid 2>/dev/null | grep -q vite; then \
				is_ours=true; break; \
			fi; \
			check_pid=$$(ps -o ppid= -p $$check_pid 2>/dev/null | tr -d ' '); \
		done; \
		echo ""; \
		if $$is_ours && [ -f frontend/node_modules/.vite-restart-needed ]; then \
			echo "Frontend deps changed — restarting Vite on port $(FRONTEND_PORT)..."; \
			kill $$pid 2>/dev/null || true; \
			rm -f frontend/node_modules/.vite-restart-needed; \
			sleep 1; \
		elif $$is_ours; then \
			echo "PsyNewView frontend is already running on port $(FRONTEND_PORT)."; \
			echo ""; \
			echo "  Nothing to do — open http://localhost:$(FRONTEND_PORT)"; \
			echo "  To restart:  kill $$pid && make frontend FRONTEND_PORT=$(FRONTEND_PORT)"; \
			echo ""; \
			exit 1; \
		else \
			proc=$$(ps -o command= -p $$pid 2>/dev/null || echo "unknown"); \
			echo "Port $(FRONTEND_PORT) is in use by another process (pid $$pid):"; \
			echo "  $$proc"; \
			echo ""; \
			echo "  To free it:  kill $$pid"; \
			echo ""; \
			exit 1; \
		fi; \
	fi
	@rm -f frontend/node_modules/.vite-restart-needed
	cd frontend && VITE_FRONTEND_PORT=$(FRONTEND_PORT) VITE_BACKEND_PORT=$(PORT) npm run dev

dev: install install-frontend ## Start both servers in background (use SLOT=N for parallel branches)
	@pid=$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		echo "Backend already running on port $(PORT)."; \
	else \
		echo "Starting backend on port $(PORT)..."; \
		log=$${TMPDIR:-/tmp}/psyneuview-backend-$(PORT).log; \
		cd backend && $(realpath $(VENV_DIR))/bin/uvicorn app.main:app --port $(PORT) --reload --reload-dir app > $$log 2>&1 & \
		bpid=$$!; \
		printf "Waiting for backend on port $(PORT) to become ready"; \
		ready=; \
		for i in $$(seq 1 60); do \
			if curl -sf -o /dev/null "http://127.0.0.1:$(PORT)/health" 2>/dev/null; then ready=1; break; fi; \
			kill -0 $$bpid 2>/dev/null || break; \
			printf "."; sleep 1; \
		done; \
		echo ""; \
		if [ -z "$$ready" ]; then \
			echo "Backend failed to become ready on port $(PORT). Last output ($$log):"; \
			tail -n 20 $$log; \
			exit 1; \
		fi; \
		echo "Backend ready on port $(PORT)."; \
	fi
	@pid=$$(lsof -tiTCP:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ] && [ ! -f frontend/node_modules/.vite-restart-needed ]; then \
		echo "Frontend already running on port $(FRONTEND_PORT)."; \
	else \
		if [ -n "$$pid" ]; then \
			echo "Frontend deps changed — restarting Vite on port $(FRONTEND_PORT)..."; \
			kill $$pid 2>/dev/null || true; \
			sleep 1; \
		else \
			echo "Starting frontend on port $(FRONTEND_PORT)..."; \
		fi; \
		rm -f frontend/node_modules/.vite-restart-needed; \
		log=$${TMPDIR:-/tmp}/psyneuview-frontend-$(FRONTEND_PORT).log; \
		cd frontend && VITE_FRONTEND_PORT=$(FRONTEND_PORT) VITE_BACKEND_PORT=$(PORT) npm run dev > $$log 2>&1 & \
		fpid=$$!; \
		printf "Waiting for frontend on port $(FRONTEND_PORT)"; \
		ready=; \
		for i in $$(seq 1 30); do \
			if [ -n "$$(lsof -tiTCP:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | head -1)" ]; then ready=1; break; fi; \
			kill -0 $$fpid 2>/dev/null || break; \
			printf "."; sleep 1; \
		done; \
		echo ""; \
		if [ -z "$$ready" ]; then \
			echo "Frontend failed to start on port $(FRONTEND_PORT). Last output ($$log):"; \
			tail -n 20 $$log; \
			exit 1; \
		fi; \
		echo "Frontend ready on port $(FRONTEND_PORT)."; \
	fi
	@echo ""
	@echo "PsyNewView is running (SLOT=$(SLOT)):"
	@echo "  Frontend:  http://localhost:$(FRONTEND_PORT)"
	@echo "  Backend:   http://localhost:$(PORT)/docs"
	@echo ""
	@echo "To stop:  make stop SLOT=$(SLOT)"

# ===================== Running a release version =====================
# The simple version:
#   make run-release   -> switch to the pinned release and start the app
#   make run-devel     -> go back to the normal latest version and start it
# Each command stops the app, switches, and starts it again for you.
# A "release" is just a saved, known-good version of the app (tagged in git);
# the current one is v0.5.8. To run a different release later:
#   make run-release RELEASE=<tag>
# The lower-level targets (checkout-release / back-to-devel) and the details
# are below.
# =====================================================================

# --- Release checkpoints (#862) ---
# Recover-FORWARD to a tagged known-good release: branch off the tag and run it.
# Never resets shared devel. Override the tag with RELEASE=<tag>.

RELEASE ?= v0.5.8

checkout-release: ## Check out a release tag to run it (RELEASE=v0.5.8); branches off the tag, never touches devel
	@git fetch --tags origin
	@git rev-parse -q --verify "refs/tags/$(RELEASE)" >/dev/null || { echo "Tag '$(RELEASE)' not found. See: git tag -l"; exit 1; }
	@git checkout -B "run-$(RELEASE)" "$(RELEASE)"
	@echo ""
	@echo "  On branch run-$(RELEASE) at tag $(RELEASE) — the release, safely on its own branch."
	@echo "  Launch it:  make stop && make start"
	@echo "  Go back:    make stop && make back-to-devel && make start"

back-to-devel: ## Return to the latest devel after running a release (git switch devel + pull --ff-only)
	@git switch devel
	@git pull --ff-only

# One-command shortcuts (stop + switch + launch), so you don't have to chain.
run-release: ## ONE COMMAND: stop, switch to the release (RELEASE=v0.5.8), and launch it
	@$(MAKE) stop
	@$(MAKE) checkout-release
	@$(MAKE) dev

run-devel: ## ONE COMMAND: stop, return to the latest devel, and launch it
	@$(MAKE) stop
	@$(MAKE) back-to-devel
	@$(MAKE) dev

start: ## Launch PsyNeuView; warn if launching from a non-devel branch
	@current_branch=$$(git rev-parse --abbrev-ref HEAD 2>/dev/null); \
	if [ -n "$$current_branch" ] && [ "$$current_branch" != "devel" ]; then \
		echo ""; \
		echo "You are launching PsyNeuView from branch: $$current_branch"; \
		echo "The standard development branch is: devel"; \
		echo ""; \
		printf "Continue anyway? [y/N] "; \
		if read -r reply </dev/tty 2>/dev/null; then :; else reply=""; fi; \
		case "$$reply" in \
			[yY]|[yY][eE][sS]) echo "Continuing on $$current_branch..."; echo "" ;; \
			*) echo "Aborted."; exit 1 ;; \
		esac; \
	fi
	@$(MAKE) dev

# --- Stop ---

stop: ## Stop servers on configured ports (use SLOT=N to match)
	@stopped=false; \
	pid=$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		kill $$pid 2>/dev/null; \
		echo "Stopped backend (pid $$pid) on port $(PORT)"; \
		stopped=true; \
	fi; \
	pid=$$(lsof -tiTCP:$(FRONTEND_PORT) -sTCP:LISTEN 2>/dev/null | head -1); \
	if [ -n "$$pid" ]; then \
		kill $$pid 2>/dev/null; \
		echo "Stopped frontend (pid $$pid) on port $(FRONTEND_PORT)"; \
		stopped=true; \
	fi; \
	if ! $$stopped; then \
		echo "Nothing running on ports $(PORT) or $(FRONTEND_PORT)."; \
	fi

stop-all: ## Stop all PsyNewView instances (scans ports 8000-8009 / 5173-5182)
	@stopped=false; \
	for port in $$(seq 8000 8009); do \
		pid=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null | head -1); \
		if [ -n "$$pid" ]; then \
			if ps -o command= -p $$pid 2>/dev/null | grep -q uvicorn; then \
				kill $$pid 2>/dev/null; \
				echo "Stopped backend (pid $$pid) on port $$port"; \
				stopped=true; \
			fi; \
		fi; \
	done; \
	for port in $$(seq 5173 5182); do \
		pid=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null | head -1); \
		if [ -n "$$pid" ]; then \
			if ps -o command= -p $$pid 2>/dev/null | grep -q vite; then \
				kill $$pid 2>/dev/null; \
				echo "Stopped frontend (pid $$pid) on port $$port"; \
				stopped=true; \
			fi; \
		fi; \
	done; \
	if ! $$stopped; then \
		echo "No PsyNewView instances found."; \
	fi

# --- Status ---

status: ## Show all running PsyNewView instances, and which checkout each serves
	@echo "PsyNewView instances:"
	@echo ""
	@served_from() { \
		cwd=$$(lsof -a -d cwd -p $$1 -Fn 2>/dev/null | sed -n 's/^n//p' | head -1); \
		if [ -z "$$cwd" ]; then echo "unknown"; return; fi; \
		root=$$(git -C "$$cwd" rev-parse --show-toplevel 2>/dev/null); \
		br=$$(git -C "$$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null); \
		if [ -n "$$root" ]; then echo "$$root @ $$br"; else echo "$$cwd (not a git checkout)"; fi; \
	}; \
	found=false; \
	for port in $$(seq 8000 8009); do \
		spid=""; \
		for cand in $$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); do \
			if ps -o command= -p $$cand 2>/dev/null | grep -qE "uvicorn|app\.main"; then spid=$$cand; break; fi; \
		done; \
		if [ -n "$$spid" ]; then \
			slot=$$((port - 8000)); \
			fport=$$((5173 + slot)); \
			fpid=$$(lsof -tiTCP:$$fport -sTCP:LISTEN 2>/dev/null | head -1); \
			fstatus="not running"; \
			[ -n "$$fpid" ] && fstatus="pid $$fpid"; \
			echo "  SLOT=$$slot  backend :$$port (pid $$spid)  frontend :$$fport ($$fstatus)"; \
			bsrc=$$(served_from $$spid); \
			echo "           backend  <- $$bsrc"; \
			if [ -n "$$fpid" ]; then \
				fsrc=$$(served_from $$fpid); \
				echo "           frontend <- $$fsrc"; \
				if [ "$$bsrc" != "$$fsrc" ] && [ "$$bsrc" != "unknown" ] && [ "$$fsrc" != "unknown" ]; then \
					echo "           !! backend and frontend are serving DIFFERENT checkouts"; \
				fi; \
			fi; \
			found=true; \
		fi; \
	done; \
	if ! $$found; then \
		echo "  No instances running."; \
	fi
	@echo ""

# --- Testing ---

test: install ## Run backend test suite
	cd backend && $(realpath $(VENV_DIR))/bin/python -m pytest tests/ -v

# --- Cleanup ---

clean-venv: ## Remove the backend virtual environment
	rm -rf $(VENV_DIR)

clean-frontend: ## Remove frontend node_modules
	rm -rf frontend/node_modules

clean: clean-venv clean-frontend ## Full clean (venv + node_modules + build artifacts)
	rm -rf frontend/dist frontend/build frontend/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete 2>/dev/null || true

# --- Info ---

info: venv ## Show installed versions
	@echo "Python: $$($(PYTHON_VENV) --version)"
	@echo ""
	@$(PIP) show psyneulink 2>/dev/null || echo "PsyNeuLink: not installed (run: make install or make install-pnl)"
	@echo ""
	@echo "Backend packages:"
	@$(PIP) list --format=columns 2>/dev/null | grep -iE "fastapi|uvicorn|websocket|watchdog|psyneulink" || true
	@echo ""
	@cd frontend && node -e "var p=require('./package.json'); console.log('Frontend: ' + p.name + ' v' + p.version)" 2>/dev/null || echo "Frontend: package.json not found"

# --- Release docs ---

RELEASE_DOCS := RELEASE_FEATURES.md RELEASE_FEATURES_SIGNOFF.md RELEASE_FEATURES_TESTING_PLAN.md
RELEASE_PDFS := $(RELEASE_DOCS:.md=.pdf)

release-tag: ## Cut a release tag on devel (VERSION=1.2.3); see #1073
	@VERSION="$(VERSION)" ./scripts/release_tag.sh

release-pdfs: $(RELEASE_PDFS) ## Regenerate release-feature PDFs from their .md sources

$(RELEASE_PDFS): %.pdf: %.md
	npx --yes md-to-pdf $<
