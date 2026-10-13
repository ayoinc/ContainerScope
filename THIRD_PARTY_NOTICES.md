# Third-party notices

ContainerScope's own code is licensed under the [Apache License 2.0](LICENSE). The app bundle also contains the third-party components below. They are distributed **unmodified** except where noted, each under its **own licence**; ContainerScope does not relicense them.

Inside the app, everything listed here lives in `ContainerScope.app/Contents/Resources/` (`Engine/`, `Kernel/`, `QEMU/`, `Firmware/`). The full licence texts and an exact versions manifest are in `ContainerScope.app/Contents/Resources/ThirdParty/` (right-click the app › **Show Package Contents**).

## Getting the source code

Several components are licensed under the GNU GPL or LGPL. For each ContainerScope release, the source code of those components is published on the [GitHub release page](https://github.com/ayoinc/ContainerScope/releases) as `ContainerScope-X.Y.Z-third-party-sources.tar`, next to the DMG. It contains the source tarball and Homebrew build recipe (`.rb`) of every bundled Homebrew formula (QEMU, swtpm and their libraries), the Linux kernel release, and the Kata Containers tree that configures and patches the kernel. Apple's engine (Apache-2.0) and EDK2 (BSD-2-Clause-Patent) aren't in the tarball; get their source from the upstream links below. The release tarball is the authoritative copy for a given release.

The pinned versions and checksums used by the build are in [`Scripts/deps.env`](Scripts/deps.env).

## Container engine and kernel

| Component | Version | Licence | Bundled as | Upstream source |
|---|---|---|---|---|
| Apple `container` (CLI, `container-apiserver`, plugins incl. machines and Kubernetes) | 1.5.0 | Apache-2.0 | `Engine/` — Apple's signed installer package, unmodified and still signed by Apple | <https://github.com/apple/container/releases/tag/1.5.0> |
| Linux kernel (`vmlinux`), Kata Containers build | 6.18.35 (Kata Containers 3.32.0) | GPL-2.0-only (with the Linux-syscall-note) | `Kernel/` — unmodified | <https://github.com/kata-containers/kata-containers/releases/tag/3.32.0> (kernel config and patches under `tools/packaging/kernel`), <https://www.kernel.org/> |

## Windows virtual machines

| Component | Version | Licence | Bundled as | Upstream source |
|---|---|---|---|---|
| QEMU (`qemu-system-aarch64`, `qemu-img`) | 11.1.2 | GPL-2.0-only (some files under GPL-2.0-or-later, LGPL-2.1-or-later, BSD and MIT) | `QEMU/` — Homebrew bottle, library paths rewritten, re-signed | <https://www.qemu.org/download/> |
| swtpm | 0.10.2 | BSD-3-Clause | `QEMU/` — Homebrew bottle, library paths rewritten, re-signed | <https://github.com/stefanberger/swtpm> |
| libtpms | 0.10.2 | BSD-3-Clause | `QEMU/lib` | <https://github.com/stefanberger/libtpms> |
| EDK2 / AAVMF (`qemu-efi-aarch64`) from Ubuntu 24.04 | Ubuntu 24.04 `edk2` source package | BSD-2-Clause-Patent (some components under other permissive licences; see the package's `debian/copyright`) | `Firmware/` — built from Ubuntu's source package with Ubuntu's build flags and pre-enrolled Microsoft Secure Boot keys; the only change is the boot logo (`MdeModulePkg/Logo/Logo.bmp`). Trailing padding is trimmed and restored on first use. | <https://launchpad.net/ubuntu/+source/edk2>, <https://github.com/tianocore/edk2>; build recipe: [`Firmware/build-aavmf.sh`](Firmware/build-aavmf.sh) |

### Libraries used by QEMU and swtpm

These come from the matching Homebrew bottles and are bundled in `QEMU/lib` with their install names rewritten (`install_name_tool`) and re-signed. The code itself is unmodified.

| Library | Version | Licence | Upstream source |
|---|---|---|---|
| capstone | 5.0.9 | BSD-3-Clause | <https://www.capstone-engine.org/> |
| dtc (libfdt) | 1.8.1 | GPL-2.0-or-later OR BSD-2-Clause | <https://git.kernel.org/pub/scm/utils/dtc/dtc.git> |
| gettext (libintl) | 1.0 | LGPL-2.1-or-later (libintl; the gettext tools are GPL-3.0-or-later and are not bundled) | <https://www.gnu.org/software/gettext/> |
| glib (libglib, libgio, libgobject, libgmodule) | 2.90.1 | LGPL-2.1-or-later | <https://gitlab.gnome.org/GNOME/glib> |
| gmp | 6.3.0 | LGPL-3.0-or-later OR GPL-2.0-or-later | <https://gmplib.org/> |
| gnutls | 3.8.13 | LGPL-2.1-or-later (library) | <https://gnutls.org/> |
| jpeg-turbo | 3.2.0 | IJG AND Zlib AND BSD-3-Clause | <https://libjpeg-turbo.org/> |
| json-glib | 1.10.8 | LGPL-2.1-or-later | <https://gitlab.gnome.org/GNOME/json-glib> |
| libidn2 | 2.3.8 | GPL-2.0-or-later OR LGPL-3.0-or-later | <https://www.gnu.org/software/libidn/#libidn2> |
| libpng | 1.6.59 | libpng-2.0 | <https://www.libpng.org/pub/png/libpng.html> |
| libslirp | 4.9.5 | BSD-3-Clause | <https://gitlab.freedesktop.org/slirp/libslirp> |
| libssh | 0.12.2 | LGPL-2.1-or-later | <https://www.libssh.org/> |
| libtasn1 | 4.21.0 | LGPL-2.1-or-later | <https://www.gnu.org/software/libtasn1/> |
| libunistring | 1.4.2 | GPL-2.0-or-later OR LGPL-3.0-or-later | <https://www.gnu.org/software/libunistring/> |
| libusb | 1.0.30 | LGPL-2.1-or-later | <https://libusb.info/> |
| lzo | 2.10 | GPL-2.0-or-later | <https://www.oberhumer.com/opensource/lzo/> |
| ncurses | 6.6 | X11-style (MIT-like) | <https://invisible-island.net/ncurses/> |
| nettle | 4.0 | GPL-2.0-or-later OR LGPL-3.0-or-later | <https://www.lysator.liu.se/~nisse/nettle/> |
| OpenSSL (libcrypto) | 4.0.3 | Apache-2.0 | <https://openssl-library.org/> |
| p11-kit | 0.26.5 | BSD-3-Clause | <https://p11-glue.github.io/p11-glue/p11-kit.html> |
| pcre2 | 10.49 | BSD-3-Clause | <https://www.pcre.org/> |
| pixman | 0.46.4 | MIT | <https://cairographics.org/> |
| snappy | 1.3.1 | BSD-3-Clause | <https://github.com/google/snappy> |
| vde (libvdeplug) | 2.3.3 | LGPL-2.1-or-later (libvdeplug) | <https://github.com/virtualsquare/vde-2> |
| zstd | 1.5.7 | BSD-3-Clause OR GPL-2.0-only | <https://github.com/facebook/zstd> |

The exact library set depends on the Homebrew bottles used for a given release; `ThirdParty/` inside the app and the release's third-party sources tarball are generated from the bundle itself and are authoritative.

## Not bundled

These are downloaded or installed separately, under their own terms, and are not distributed by ContainerScope:

- **Windows 11** — downloaded from Microsoft's official links in the app; use is governed by Microsoft's licence terms.
- **VirtIO drivers for Windows** (`virtio-win.iso`) — downloaded from the Fedora project's mirror.
- **Container images** — pulled from the registries you choose; each image has its own licences.
- **Rosetta 2** — part of macOS, installed by Apple's software update.
- **socktainer** (optional) — installed by you with Homebrew.

## Artwork

The ContainerScope logo, app icon and boot logo in [`Artwork/`](Artwork) and [`Firmware/Logo.png`](Firmware/Logo.png) are part of ContainerScope and covered by its Apache-2.0 licence. The Apache License does not grant trademark rights to the ContainerScope name or logo (section 6).

"Apple", "macOS" and "Rosetta" are trademarks of Apple Inc. "Windows" is a trademark of Microsoft Corporation. "Kubernetes" is a trademark of The Linux Foundation. ContainerScope is not affiliated with or endorsed by any of them.
