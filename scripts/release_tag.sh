#!/bin/bash
#
# Cut a PsyNeuView release tag, per the convention in issue #1073.
#
#   make release-tag VERSION=1.2.3
#
# Creates an annotated tag locally after checking everything the convention
# requires, and stops there. Pushing is a separate, deliberate step: a pushed tag
# is what a Mac app release builds against, and the convention says a tag never
# moves once that has happened.
#
# Checks, in order, each refusing rather than warning:
#   - VERSION looks like a release version
#   - the tag does not already exist, locally or on the remote
#   - you are on devel
#   - the working tree is clean
#   - devel is level with origin
#   - CI is green on this exact commit
set -euo pipefail

VERSION="${VERSION:-}"
TAG="v${VERSION}"
REPO="jonhanke-nam/PsyNeuView"

fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { echo "  ✓ $1"; }

echo "Preparing ${TAG}..."

[ -n "${VERSION}" ] || fail "no VERSION. Usage: make release-tag VERSION=1.2.3"
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "VERSION must be MAJOR.MINOR.PATCH (got '${VERSION}'). See #1073."
ok "version format"

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null \
    && fail "${TAG} already exists locally. A tag never moves once shipped against (#1073)."
git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1 \
    && fail "${TAG} already exists on origin. A tag never moves once shipped against (#1073)."
ok "tag is unused"

BRANCH="$(git branch --show-current)"
[ "${BRANCH}" = "devel" ] || fail "release tags are cut on devel; you are on '${BRANCH}'."
ok "on devel"

[ -z "$(git status --porcelain)" ] || fail "working tree is dirty; commit or stash first."
ok "clean working tree"

git fetch origin --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/devel)"
[ "${LOCAL}" = "${REMOTE}" ] \
    || fail "devel is not level with origin. Pull or push first, so the tag names what others see."
ok "level with origin/devel"

# The gate that matters. "skipped" is not "passed": path filters legitimately
# skip suites on docs-only commits, so report what actually ran and let the
# person decide, rather than silently treating absence as success.
if command -v gh >/dev/null 2>&1; then
    SUMMARY="$(gh api "repos/${REPO}/commits/${LOCAL}/check-runs" \
        --jq '[.check_runs[] | select(.name | test("pytest|e2e|typecheck|vitest|tutorials|smoke"))]
              | "\([.[] | select(.conclusion=="success")] | length) passed, \([.[] | select(.conclusion=="failure")] | length) failed, \([.[] | select(.conclusion=="skipped")] | length) skipped"' \
        2>/dev/null || echo "")"
    if [ -z "${SUMMARY}" ]; then
        echo "  ! could not read CI status for ${LOCAL:0:8} — check by hand before pushing"
    else
        FAILED="$(echo "${SUMMARY}" | sed -n 's/.*, \([0-9]*\) failed.*/\1/p')"
        PASSED="$(echo "${SUMMARY}" | sed -n 's/^\([0-9]*\) passed.*/\1/p')"
        [ "${FAILED:-0}" -eq 0 ] || fail "CI on ${LOCAL:0:8}: ${SUMMARY}. A release must not be cut from a red commit."
        if [ "${PASSED:-0}" -eq 0 ]; then
            echo "  ! CI on ${LOCAL:0:8}: ${SUMMARY}"
            echo "    No suite ran on this commit. That is normal for a docs-only change —"
            echo "    the code is unchanged since the last tested commit — but confirm that"
            echo "    is why before pushing."
        else
            ok "CI green on ${LOCAL:0:8} (${SUMMARY})"
        fi
    fi
else
    echo "  ! gh not installed — CI status unchecked"
fi

MESSAGE_FILE="$(mktemp)"
trap 'rm -f "${MESSAGE_FILE}"' EXIT
cat > "${MESSAGE_FILE}" <<TEMPLATE
PsyNeuView ${VERSION}

<one paragraph: what this release is for, in a user's terms>

TEMPLATE
git log --pretty='- %s' "$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo HEAD~20)..HEAD" \
    --no-merges >> "${MESSAGE_FILE}" 2>/dev/null || true

git tag -a "${TAG}" -e -F "${MESSAGE_FILE}"

echo ""
echo "  ✓ ${TAG} created locally."
echo ""
echo "  Review it:   git show ${TAG}"
echo "  Publish it:  git push origin ${TAG}"
echo "  Undo it:     git tag -d ${TAG}"
echo ""
echo "  Pushing is deliberate: a Mac app release builds against this tag, and"
echo "  the tag must not move afterwards (#1073)."
