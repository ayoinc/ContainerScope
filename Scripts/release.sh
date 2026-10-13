#!/bin/sh
# Cuts a release: bumps VERSION, commits, tags vX.Y.Z and pushes. The tag triggers
# .github/workflows/release.yml, which builds the DMG and publishes the GitHub Release.
#   Scripts/release.sh 0.2.0
set -eu

NEW="${1:-}"
echo "$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: $0 MAJOR.MINOR.PATCH" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ "$(git branch --show-current)" = main ] || { echo "Release from main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null && { echo "v$NEW already exists" >&2; exit 1; }

if [ "$(cat VERSION)" != "$NEW" ]; then
  echo "$NEW" > VERSION
  git commit -q -m "Release v$NEW" VERSION
fi
git tag -a "v$NEW" -m "ContainerScope $NEW"
git push -q origin main "v$NEW"
echo "Pushed v$NEW; the Release workflow will publish ContainerScope-$NEW.dmg"
