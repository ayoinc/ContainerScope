#!/bin/sh
# Stages everything ContainerScope.app bundles into build/deps (pinned in Scripts/deps.env):
#   engine/      Apple's signed container engine, unpacked unmodified from its installer
#   kernel/      the Linux kernel containers boot (Kata build the engine recommends)
#   qemu/        qemu-system-aarch64, qemu-img, swtpm + their dylibs, relocated (needs `brew install qemu swtpm`)
#   firmware/    Secure Boot UEFI (Scripts/build-firmware.sh, unless already staged, e.g. by CI)
#   thirdparty/  licence texts and versions.json
# Downloads are cached in $DEPS_CACHE (default ~/Library/Caches/ContainerScope-build) and checked by SHA-256.
# Re-running only redoes stages whose output is missing; delete build/deps/<stage> to redo one.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/Scripts/deps.env"
DEPS="$ROOT/build/deps"
CACHE="${DEPS_CACHE:-$HOME/Library/Caches/ContainerScope-build}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p "$DEPS" "$CACHE"

fetch() {  # url sha256 → cached file path
  file="$CACHE/$(basename "$1")"
  if [ ! -f "$file" ] || ! echo "$2  $file" | shasum -a 256 -c - >/dev/null 2>&1; then
    echo "Downloading $1" >&2
    curl -fL --retry 3 -o "$file.part" "$1"
    echo "$2  $file.part" | shasum -a 256 -c - >/dev/null || { echo "SHA-256 mismatch for $1" >&2; rm -f "$file.part"; exit 1; }
    mv "$file.part" "$file"
  fi
  echo "$file"
}

# Engine: the payload keeps Apple's own signatures; the /usr/local install/uninstall scripts don't apply.
if [ ! -x "$DEPS/engine/bin/container" ]; then
  pkg="$(fetch "$CONTAINER_PKG_URL" "$CONTAINER_PKG_SHA256")"
  pkgutil --check-signature "$pkg" | grep -q "Developer ID Installer: Apple Inc." || { echo "Engine installer is not signed by Apple" >&2; exit 1; }
  tmp="$(mktemp -d)"
  pkgutil --expand-full "$pkg" "$tmp/x"
  rm -rf "$DEPS/engine" && mkdir -p "$DEPS/engine"
  cp -R "$tmp/x/Payload/bin" "$tmp/x/Payload/libexec" "$DEPS/engine/"
  rm -f "$DEPS/engine/bin/uninstall-container.sh" "$DEPS/engine/bin/update-container.sh"
  rm -rf "$tmp"
fi

# Kernel: one member of the 700 MB Kata archive.
if [ ! -f "$DEPS/kernel/$(basename "$KERNEL_MEMBER")" ]; then
  archive="$(fetch "$KATA_URL" "$KATA_SHA256")"
  command -v zstd >/dev/null || { echo "zstd is required (brew install zstd)" >&2; exit 1; }
  rm -rf "$DEPS/kernel" && mkdir -p "$DEPS/kernel"
  zstd -dc "$archive" | tar -xf - -C "$DEPS/kernel" "./$KERNEL_MEMBER" 2>/dev/null \
    || zstd -dc "$archive" | tar -xf - -C "$DEPS/kernel" "$KERNEL_MEMBER"
  mv "$DEPS/kernel/$KERNEL_MEMBER" "$DEPS/kernel/"
  rm -rf "$DEPS/kernel/opt"
fi

# QEMU + swtpm: copy the binaries and every Homebrew dylib they load, rewritten to load from
# ../lib, so nothing outside the app bundle is needed. Signing happens in build-app.sh.
if [ ! -x "$DEPS/qemu/bin/qemu-system-aarch64" ]; then
  command -v brew >/dev/null || { echo "Homebrew is required to stage QEMU (brew install qemu swtpm)" >&2; exit 1; }
  for formula in $QEMU_FORMULAE; do brew list --versions "$formula" >/dev/null || { echo "Run: brew install $QEMU_FORMULAE" >&2; exit 1; }; done
  prefix="$(brew --prefix)"
  Q="$DEPS/qemu.partial"
  rm -rf "$Q" && mkdir -p "$Q/bin" "$Q/lib" "$Q/share/qemu"
  for tool in qemu-system-aarch64 qemu-img swtpm; do
    cp "$(realpath "$prefix/bin/$tool")" "$Q/bin/$tool"
    chmod u+w "$Q/bin/$tool"
  done
  # Breadth-first over load commands; each Homebrew dependency becomes lib/<basename>.
  queue="$(ls "$Q"/bin/*)"
  while [ -n "$queue" ]; do
    next=""
    for file in $queue; do
      for dep in $(otool -L "$file" | tail -n +2 | awk '{print $1}' | grep "^$prefix/"); do
        name="$(basename "$dep")"
        if [ ! -f "$Q/lib/$name" ]; then
          cp "$(realpath "$dep")" "$Q/lib/$name"
          chmod u+w "$Q/lib/$name"
          install_name_tool -id "@rpath/$name" "$Q/lib/$name" 2>/dev/null
          next="$next $Q/lib/$name"
        fi
        install_name_tool -change "$dep" "@rpath/$name" "$file" 2>/dev/null
      done
    done
    queue="$next"
  done
  for tool in "$Q"/bin/*; do install_name_tool -add_rpath "@executable_path/../lib" "$tool" 2>/dev/null; done
  for lib in "$Q"/lib/*.dylib; do install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true; done
  if otool -L "$Q"/bin/* "$Q"/lib/*.dylib | grep -q "$prefix/"; then
    echo "Unrelocated Homebrew paths remain:" >&2; otool -L "$Q"/bin/* "$Q"/lib/*.dylib | grep "$prefix/" >&2; exit 1
  fi
  # Data QEMU loads at runtime: NIC option ROMs, VGA BIOSes, keyboard maps (not the 64 MiB EDK2 images).
  cp "$prefix/share/qemu/"efi-*.rom "$prefix/share/qemu/"vgabios*.bin "$Q/share/qemu/"
  cp -R "$prefix/share/qemu/keymaps" "$Q/share/qemu/"
  # Versions of every formula that contributed a file, for the licence notices and source archive.
  : > "$Q/formulae.txt"
  for formula in $(brew deps --installed --union $QEMU_FORMULAE) $QEMU_FORMULAE; do
    keg="$(brew --prefix "$formula")"
    used=no
    for lib in "$Q"/lib/*.dylib; do [ -e "$keg/lib/$(basename "$lib")" ] || [ -e "$keg/lib/swtpm/$(basename "$lib")" ] && used=yes && break; done
    case " $QEMU_FORMULAE " in *" $formula "*) used=yes ;; esac
    [ "$used" = yes ] && echo "$formula $(brew list --versions "$formula" | awk '{print $NF}')" >> "$Q/formulae.txt"
  done
  sort -u -o "$Q/formulae.txt" "$Q/formulae.txt"
  rm -rf "$DEPS/qemu" && mv "$Q" "$DEPS/qemu"
fi

# Firmware: CI stages it from a Linux build job; locally build it in a container.
if [ ! -f "$DEPS/firmware/VERSION" ]; then
  "$ROOT/Scripts/build-firmware.sh" "$DEPS/firmware"
fi

# Licences + versions manifest.
T="$DEPS/thirdparty"
rm -rf "$T" && mkdir -p "$T"
mkdir -p "$T/container" "$T/linux" "$T/edk2"
curl -fsSL "https://raw.githubusercontent.com/apple/container/$CONTAINER_VERSION/LICENSE" -o "$T/container/LICENSE"
curl -fsSL "https://raw.githubusercontent.com/kata-containers/kata-containers/$KATA_VERSION/LICENSE" -o "$T/linux/kata-containers-LICENSE"
curl -fsSL "https://raw.githubusercontent.com/torvalds/linux/master/LICENSES/preferred/GPL-2.0" -o "$T/linux/GPL-2.0"
cp "$DEPS/firmware/"License* "$DEPS/firmware/copyright" "$T/edk2/" 2>/dev/null || true
while read -r formula version; do
  keg="$(brew --prefix "$formula")"
  mkdir -p "$T/$formula"
  find "$keg/" -maxdepth 1 -type f \( -iname 'LICENSE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' -o -iname '*GPL*' -o -iname 'COPYRIGHT*' \) -exec cp {} "$T/$formula/" \;
  [ -n "$(ls "$T/$formula")" ] || brew info --json=v2 "$formula" | python3 -c 'import json,sys; print("License:", json.load(sys.stdin)["formulae"][0]["license"])' > "$T/$formula/LICENSE-SPDX.txt"
done < "$DEPS/qemu/formulae.txt"
cp "$DEPS/qemu/formulae.txt" "$T/homebrew-formulae.txt"
python3 - "$T/versions.json" "$DEPS/qemu/formulae.txt" "$DEPS/firmware/VERSION" <<EOF
import json, sys
formulae = {name: version.split("_")[0] for name, version in (line.split() for line in open(sys.argv[2]) if line.strip())}
json.dump({
    "container": "$CONTAINER_VERSION",
    "kernel": "$KERNEL_VERSION (Kata Containers $KATA_VERSION)",
    "qemu": formulae.get("qemu", ""),
    "swtpm": formulae.get("swtpm", ""),
    "firmware": open(sys.argv[3]).read().strip(),
}, open(sys.argv[1], "w"), indent=2, sort_keys=True)
EOF
echo "$DEPS"
