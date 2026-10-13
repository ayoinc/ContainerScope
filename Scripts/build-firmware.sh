#!/bin/sh
# Builds the Secure Boot UEFI firmware (Firmware/build-aavmf.sh) in an ubuntu:24.04 arm64 container,
# using Apple `container` (macOS) or Docker (CI's Linux arm64 runner), then trims the zero padding
# QEMU's 64 MiB pflash images carry; the app restores it on first use.
#   Scripts/build-firmware.sh [OUT]   (default build/deps/firmware)
# Writes AAVMF_CODE.ms.fd, AAVMF_VARS.ms.fd, VERSION and the EDK2 licence files.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/build/deps/firmware}"
RAW="$(mktemp -d)"
trap 'rm -rf "$RAW"' EXIT

if command -v container >/dev/null 2>&1; then
  run="container run --rm -c 8 -m 8G"
elif command -v docker >/dev/null 2>&1; then
  run="docker run --rm --platform linux/arm64"
else
  echo "Building firmware needs Apple container or Docker" >&2; exit 1
fi
$run -v "$ROOT/Firmware:/in:ro" -v "$RAW:/out" docker.io/library/ubuntu:24.04 sh /in/build-aavmf.sh > "$RAW/VERSION"

mkdir -p "$OUT"
python3 - "$RAW" "$OUT" <<'EOF'
import os, sys
raw, out = sys.argv[1:]
for name in ("AAVMF_CODE.ms.fd", "AAVMF_VARS.ms.fd"):
    data = open(os.path.join(raw, name), "rb").read()
    assert len(data) == 64 << 20, f"{name}: expected a 64 MiB pflash image, got {len(data)} bytes"
    open(os.path.join(out, name), "wb").write(data.rstrip(b"\0"))
EOF
tail -n 1 "$RAW/VERSION" > "$OUT/VERSION"
cp "$RAW/License.txt" "$RAW/copyright" "$OUT/"
echo "$OUT"
