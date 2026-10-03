#!/usr/bin/env bash
# Naming guard. Fails if the upstream project's name appears anywhere that
# reaches GitHub: file contents, file names, commit messages, or any blob in
# the commit graph.
#
# The name is stored encoded on purpose. Written out literally, this script
# would be the one file in the repo that breaks its own rule.
#
#   bash scripts/check-naming.sh
set -uo pipefail

WORD="$(printf '%s' 'c2NyZWVuaXR5' | base64 -d)"
fail=0

report() {
  echo "FAIL: $1"
  sed 's/^/    /' <<<"$2" | head -20
  fail=1
}

hits="$(git grep -il -e "$WORD" -- . 2>/dev/null || true)"
[ -n "$hits" ] && report "file contents" "$hits"

hits="$(git ls-files | grep -i -e "$WORD" || true)"
[ -n "$hits" ] && report "file names" "$hits"

# The two history checks need a full clone (fetch-depth: 0 in CI).
hits="$(git log --all --format='%h %s%n%b' | grep -i -e "$WORD" || true)"
[ -n "$hits" ] && report "commit messages" "$hits"

# Removing a reference from the working tree does not remove it from history.
revs="$(git rev-list --all 2>/dev/null || true)"
if [ -n "$revs" ]; then
  # shellcheck disable=SC2086
  hits="$(git grep -il -e "$WORD" $revs -- 2>/dev/null | sort -u || true)"
  [ -n "$hits" ] && report "commit history" "$hits"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "The upstream project's name must never reach this repository."
  exit 1
fi
echo "naming guard: clean"
