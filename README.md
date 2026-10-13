<p align="center"><img src="Artwork/hero.png" alt="ContainerScope" width="100%"></p>

ContainerScope is a native macOS app (Swift + WebKit) for Apple's [`container`](https://github.com/apple/container) engine. It shows your containers, images, volumes, networks and engine health. It also runs Windows 11 on ARM virtual machines on Hypervisor.framework, with nothing between the app and the raw QEMU tools.

## Install

Download `ContainerScope-<version>.dmg` from [Releases](../../releases), open it, and drag **ContainerScope** to **Applications**. Release builds are signed with a Developer ID and notarized by Apple, so they open without Gatekeeper warnings.

Requires macOS 26 on Apple Silicon with Apple `container` installed (`brew install container`).

## What's inside

| Section | What it does |
|---|---|
| Overview, Containers, Images, Volumes, Networks | Live state and usage of everything the `container` engine manages |
| Machines | Linux machines, including nested virtualization |
| Kubernetes | Clusters running on the engine |
| Windows | Windows 11 on ARM VMs: QEMU + HVF, UEFI Secure Boot, swtpm TPM 2.0, NVMe disk, VirtIO network and display |
| Engine | Engine status, start/stop/restart, upgrades, kernel |

### Windows on ARM

- **Windows download:** the app gets fresh links to the official Microsoft Arm64 ISO for any version and language. It also downloads the Fedora VirtIO driver ISO. Both go to a temporary folder, and **Clean Up** deletes them when you're done.
- **Secure Boot firmware:** **Get Secure Boot Firmware** builds Ubuntu's `qemu-efi-aarch64` package from source inside your container engine, with the ContainerScope logo in place of TianoCore. Ubuntu's build flags and pre-enrolled Microsoft keys are kept as they are. The recipe is in [`Firmware/build-aavmf.sh`](Firmware/build-aavmf.sh); to run it by hand:
  ```sh
  container run --rm -c 8 -m 8G -v "$PWD/Firmware:/in:ro" -v "$OUT:/out" \
    docker.io/library/ubuntu:24.04 sh /in/build-aavmf.sh
  ```
- **Tools:** QEMU and swtpm come from Homebrew. **Install QEMU** in the app runs `brew install qemu swtpm`.
- **Display:** VMs start with `ramfb`, a fixed-size framebuffer Windows can use without extra drivers, so Setup works. After installing the ARM64 VirtIO drivers (`pnputil /add-driver E:\*\w11\ARM64\*.inf /subdirs /install`; `virtio-win-guest-tools.exe` is x64-only), switch the VM to **VirtIO GPU** (`viogpudo`) for a resizable display.

## Build

```sh
Scripts/build-app.sh      # build/ContainerScope.app (SwiftPM, no Xcode project)
Scripts/build-dmg.sh      # build/ContainerScope-<version>.dmg
```

Without extra settings, builds get an ad-hoc signature for local use. For a signed, notarized local build:

```sh
export SIGN_IDENTITY="Developer ID Application: …"    # or the identity's SHA-1
export NOTARY_PROFILE=containerscope                 # xcrun notarytool store-credentials containerscope …
Scripts/build-app.sh && Scripts/build-dmg.sh
```

To change the artwork, edit the SVGs in [`Artwork/`](Artwork). [`mark.svg`](Artwork/mark.svg) is the one source for the logo. Run `Artwork/render.sh` (needs `brew install resvg`) to regenerate `AppIcon.icns`, `hero.png` and `Firmware/Logo.png`.

## Releases

The version lives in [`VERSION`](VERSION). The build number is the git commit count.

```sh
Scripts/release.sh 0.2.0
```

This bumps `VERSION`, commits, tags `v0.2.0` and pushes. The tag starts the [Release workflow](.github/workflows/release.yml) on a `macos-26` runner, which:

1. Checks that the tag matches `VERSION`.
2. Imports the Developer ID identity into a temporary keychain.
3. Builds the app with the hardened runtime.
4. Notarizes the DMG and staples the ticket.
5. Publishes a GitHub Release with the DMG, its SHA-256 and generated release notes.

The Release workflow uses these repository secrets:

| Secret | Contents |
|---|---|
| `DEVELOPER_ID_P12_BASE64` / `DEVELOPER_ID_P12_PASSWORD` | Developer ID Application certificate and private key (`.p12`, base64) |
| `NOTARY_KEY_P8` / `NOTARY_KEY_ID` / `NOTARY_ISSUER` | App Store Connect API key with Developer access, used by `notarytool` |

Every push to `main` and every pull request runs [CI](.github/workflows/ci.yml), which uploads the DMG as a build artifact.
