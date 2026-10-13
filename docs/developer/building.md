# Building ContainerScope

ContainerScope builds with SwiftPM and a few shell scripts. You don't need an Xcode project.

## Requirements

- A Mac with Apple silicon on **macOS 26** or later.
- **Xcode 26** or the **Command Line Tools for Xcode 26** (Swift 6, macOS 26 SDK). Check with `swift --version` and `xcrun --show-sdk-version`.
- **Homebrew**, for the QEMU and swtpm that get copied into the app, and `zstd` to unpack the kernel:
  ```sh
  brew install qemu swtpm zstd
  ```
- **Apple `container` or Docker**, to build the Secure Boot firmware in an Ubuntu container (only the first time; see [Firmware](#firmware)).
- About 2 GB free for downloads and the build.

## Quick build

```sh
git clone https://github.com/ayoinc/ContainerScope.git
cd ContainerScope
Scripts/fetch-deps.sh     # stage the bundled components into build/deps
Scripts/build-app.sh      # build/ContainerScope.app (about 520 MB)
open build/ContainerScope.app
```

To make a DMG as well:

```sh
Scripts/build-dmg.sh      # build/ContainerScope-<version>.dmg
```

## What each script does

### `Scripts/fetch-deps.sh`

Stages everything the app bundles into `build/deps/`, using the versions and SHA-256 checksums pinned in [`Scripts/deps.env`](../../Scripts/deps.env):

| Folder | Contents | Source |
|---|---|---|
| `engine/` | `bin/` and `libexec/` of Apple's `container` engine | Apple's signed installer package, checked with `pkgutil --check-signature` and unpacked unmodified |
| `kernel/` | `vmlinux-…` | One file from the Kata Containers release archive |
| `qemu/` | `qemu-system-aarch64`, `qemu-img`, `swtpm`, their dylibs, QEMU's ROMs and keymaps, `formulae.txt` | Your Homebrew installation, relocated with `install_name_tool` to load from `../lib` |
| `firmware/` | `AAVMF_CODE.ms.fd`, `AAVMF_VARS.ms.fd`, `VERSION`, EDK2 licence files | `Scripts/build-firmware.sh` |
| `thirdparty/` | Licence texts and `versions.json` | Upstream repositories and Homebrew kegs |

Downloads are cached in `~/Library/Caches/ContainerScope-build` (override with `DEPS_CACHE`) and verified against `deps.env` every time. The script only redoes stages whose output is missing, so to refresh one, delete it and run the script again:

```sh
rm -rf build/deps/qemu && Scripts/fetch-deps.sh
```

The script fails if any Homebrew path is left unrelocated in the QEMU binaries, so a build that passes this step doesn't depend on Homebrew at runtime.

### `Scripts/build-app.sh`

1. Checks that `build/deps` is complete. If a stage is missing it stops with `Missing build/deps/<stage>; run Scripts/fetch-deps.sh first`.
2. `swift build -c release`.
3. Assembles `build/ContainerScope.app`: the binary, `Web/`, the icon, and the staged components under `Contents/Resources/` (`Engine/`, `Kernel/`, `QEMU/`, `Firmware/`, `ThirdParty/`), plus `Info.plist`.
4. Signs inside out: QEMU's libraries, `qemu-img` and `swtpm`, `qemu-system-aarch64` with the Hypervisor entitlement ([`Scripts/qemu.entitlements`](../../Scripts/qemu.entitlements)), then the app. The engine keeps Apple's signature.

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `SIGN_IDENTITY` | unset → ad hoc signature | Developer ID Application identity (name or SHA-1). Signs with the hardened runtime and a secure timestamp, as notarization requires. |
| `CONFIG` | `release` | SwiftPM configuration (`debug` for faster builds). |
| `VERSION` | contents of [`VERSION`](../../VERSION) | `CFBundleShortVersionString`. |
| `BUILD` | commit count | `CFBundleVersion`. |

### `Scripts/build-dmg.sh`

Packages `build/ContainerScope.app` into `build/ContainerScope-<version>.dmg` (drag-to-Applications layout, LZFSE-compressed). With `SIGN_IDENTITY` it signs the DMG; with notarization credentials it also notarizes and staples it. See [Releasing](releasing.md).

## Firmware

The Secure Boot UEFI firmware is Ubuntu's `qemu-efi-aarch64` (AAVMF), rebuilt from Ubuntu 24.04's `edk2` source package with only the boot logo changed. [`Firmware/build-aavmf.sh`](../../Firmware/build-aavmf.sh) is the recipe; [`Scripts/build-firmware.sh`](../../Scripts/build-firmware.sh) runs it in an `ubuntu:24.04` arm64 container, with Apple `container` if it's installed or Docker otherwise, and trims the 64 MiB images' zero padding (the app restores it on first use).

`fetch-deps.sh` runs it automatically when `build/deps/firmware` is missing. It takes a while (a full EDK2 build) but only happens once; the result stays in `build/deps/firmware`. You can also run it on its own:

```sh
Scripts/build-firmware.sh              # → build/deps/firmware
```

The firmware build needs a container engine that's already running. If you use ContainerScope's bundled engine for that, start it from the app first. In CI the firmware is built on a Linux arm64 runner and handed to the macOS job, so it's only rebuilt when `Firmware/` or `Scripts/build-firmware.sh` changes.

## Artwork

[`Artwork/mark.svg`](../../Artwork/mark.svg) is the logo source. [`Artwork/render.sh`](../../Artwork/render.sh) regenerates `AppIcon.icns`, `hero.png` and `Firmware/Logo.png` from the SVGs (needs `brew install resvg`). The rendered files are committed, so you only run it after changing the artwork. A new `Firmware/Logo.png` means rebuilding the firmware.

## Developing

- **Web UI changes** need only `Scripts/build-app.sh` (or copy `Sources/ContainerScope/Web` into `build/ContainerScope.app/Contents/Resources/Web` and reload). The web view is inspectable: enable Safari's **Develop** menu, then **Develop › <your Mac> › ContainerScope**.
- **Use another engine** by launching with `CONTAINER_BIN`:
  ```sh
  CONTAINER_BIN=/path/to/container build/ContainerScope.app/Contents/MacOS/ContainerScope
  ```
- **Only one engine runs at a time.** If you switch between a Homebrew engine and the bundled one, stop the other first (`container system stop`).
- Run the bundled engine from Terminal with `build/ContainerScope.app/Contents/Resources/Engine/bin/container`.

## Continuous integration

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on pushes to `main` and on pull requests:

1. **Firmware**: the reusable [`firmware.yml`](../../.github/workflows/firmware.yml) workflow runs on `ubuntu-24.04-arm` and builds the firmware with `Scripts/build-firmware.sh` (Docker). The result is cached by the hash of `Firmware/**` and `Scripts/build-firmware.sh`, so most runs only restore it, and is passed on as the `firmware` artifact.
2. **Build** on `macos-26`: downloads the `firmware` artifact into `build/deps/firmware`, restores the download cache (`~/Library/Caches/ContainerScope-build`, keyed on `Scripts/deps.env`), runs `brew install qemu swtpm zstd && Scripts/fetch-deps.sh`, then `Scripts/build-app.sh` (ad hoc signed) and `Scripts/build-dmg.sh`.
3. Uploads the DMG as the `ContainerScope-dmg` artifact for 14 days.

CI artifacts are signed ad hoc and not notarized, so macOS will ask before opening them.
