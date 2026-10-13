#!/bin/sh
# Collects the corresponding source for the bundled third-party binaries into one archive, attached
# to each GitHub Release (QEMU, the Linux kernel and several libraries are GPL/LGPL):
#   - the source tarball and Homebrew build recipe (.rb) of every formula listed in build/deps/qemu/formulae.txt
#   - the Linux kernel release and the Kata Containers tree that configures and patches it
# Apple's engine (Apache-2.0) and EDK2 (BSD-2-Clause-Patent) are linked from THIRD_PARTY_NOTICES.md.
#   Scripts/collect-sources.sh OUT.tar
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/Scripts/deps.env"
OUT="$1"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/sources/homebrew"

while read -r formula version; do
  brew fetch --build-from-source --quiet "$formula" >/dev/null
  cp "$(brew --cache --build-from-source "$formula")" "$STAGE/sources/homebrew/"
  brew cat "$formula" > "$STAGE/sources/homebrew/$formula-$version.rb"
done < "$ROOT/build/deps/qemu/formulae.txt"

curl -fsSL --retry 3 -o "$STAGE/sources/linux-$KERNEL_VERSION.tar.xz" \
  "https://cdn.kernel.org/pub/linux/kernel/v${KERNEL_VERSION%%.*}.x/linux-$KERNEL_VERSION.tar.xz"
curl -fsSL --retry 3 -o "$STAGE/sources/kata-containers-$KATA_VERSION.tar.gz" \
  "https://github.com/kata-containers/kata-containers/archive/refs/tags/$KATA_VERSION.tar.gz"
cp "$ROOT/build/deps/qemu/formulae.txt" "$STAGE/sources/homebrew/formulae.txt"

tar -cf "$OUT" -C "$STAGE" sources
echo "$OUT"
