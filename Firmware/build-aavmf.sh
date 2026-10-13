#!/bin/sh
# Builds Ubuntu's Secure Boot ARM64 UEFI firmware (qemu-efi-aarch64) from its own source package,
# with the ContainerScope boot logo in place of TianoCore. Build flags, Secure Boot and the
# pre-enrolled Microsoft keys are exactly Ubuntu's; only MdeModulePkg/Logo/Logo.bmp changes.
#
# Runs inside an ubuntu:24.04 container on Apple Silicon (native arm64 build):
#   container run --rm -c 8 -m 8G -v "$PWD/Firmware:/in:ro" -v "$OUT:/out" \
#     docker.io/library/ubuntu:24.04 sh /in/build-aavmf.sh
# Writes /out/AAVMF_CODE.ms.fd and /out/AAVMF_VARS.ms.fd (64 MiB pflash images), plus EDK2's
# License.txt and Ubuntu's debian/copyright. Prints the package version on stdout.
set -eu
export DEBIAN_FRONTEND=noninteractive

sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources
apt-get update -qq >/dev/null
apt-get install -y -qq dpkg-dev python3-pil >/dev/null
cd /root
apt-get source -qq edk2 >/dev/null 2>&1
apt-get build-dep -y -qq edk2 >/dev/null 2>&1
cd edk2-*/

# EDK2's BMP decoder takes uncompressed 24-bit; LogoDxe centres it and publishes it through BGRT.
python3 -c 'from PIL import Image; Image.open("/in/Logo.png").convert("RGB").save("MdeModulePkg/Logo/Logo.bmp")'

debian/rules build-qemu-efi-aarch64 >/root/build.log 2>&1 || { tail -40 /root/build.log; exit 1; }
# Write then rename: a running VM keeps its open copy instead of seeing the file change under it.
cp debian/aavmf-install/AAVMF_CODE.secboot.fd /out/.AAVMF_CODE.ms.fd.new
cp debian/aavmf-install/AAVMF_VARS.ms.fd /out/.AAVMF_VARS.ms.fd.new
mv /out/.AAVMF_CODE.ms.fd.new /out/AAVMF_CODE.ms.fd
mv /out/.AAVMF_VARS.ms.fd.new /out/AAVMF_VARS.ms.fd
cp License.txt /out/License.txt
cp debian/copyright /out/copyright
dpkg-parsechangelog -S Version | sed 's/$/ + ContainerScope logo/'
