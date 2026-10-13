<p align="center"><img src="Artwork/hero.png" alt="ContainerScope" width="100%"></p>

ContainerScope is a native macOS app for running Linux containers, Linux virtual machines, Kubernetes clusters and Windows 11 on ARM virtual machines on an Apple silicon Mac. It's built on Apple's [`container`](https://github.com/apple/container) engine and on QEMU with Hypervisor.framework, and it ships everything they need inside the app: download it, open it, and it works. No Homebrew, no administrator password.

ContainerScope is free and open source under the [Apache License 2.0](LICENSE).

## Install

1. Download `ContainerScope-<version>.dmg` (about 200 MB) from [Releases](https://github.com/ayoinc/ContainerScope/releases/latest).
2. Open it and drag **ContainerScope** to **Applications**.
3. Open ContainerScope. On first start it starts the container engine and installs the Linux kernel for containers.

Release builds are signed with a Developer ID and notarized by Apple, so they open without Gatekeeper warnings. Each release also has a `.sha256` file to check the download:

```sh
shasum -a 256 -c ContainerScope-<version>.dmg.sha256
```

### Requirements

- A Mac with Apple silicon (M1 or later) running **macOS 26** or later.
- **Rosetta 2** for Kubernetes and x86-64 images. It's part of macOS; ContainerScope installs it in one click.
- For Windows VMs: a **Windows 11 ARM64 ISO** and the **VirtIO driver ISO**. ContainerScope downloads both for you from Microsoft and Fedora.

Container images are pulled from registries when you use them. The **Requirements** section of the Engine page tags each item **Included**, **Ready**, **You provide**, **Optional** or **Needs attention**; Overview shows a banner only for items that need attention.

## What it does

| Sidebar | What you get |
|---|---|
| **Containers** › Overview | Live CPU, memory, network and disk activity, running containers, disk usage and engine health |
| **Containers** › Containers, Images, Volumes, Networks | Everything the engine manages: start, stop, shell, logs, processes, inspect, pull, prune, network health checks |
| **Containers** › Orchestration | Kubernetes clusters on the engine (`container k8s`): nodes, pods, image loading, kubeconfig. Docker Compose projects through socktainer |
| **Virtualization** › Linux | Persistent Linux VMs (`container machine`) from Ubuntu, Debian, Fedora, Alpine or any OCI image, with nested virtualization on M3 or later |
| **Virtualization** › Windows on ARM | Windows 11 VMs on QEMU + Hypervisor.framework: UEFI Secure Boot, TPM 2.0, NVMe disk, VirtIO network and display, installer downloads |
| **System** › Engine | Engine status, start/stop/restart, updates, kernels, Rosetta, requirements, Docker API (socktainer) and Vagrant |

### What's in the app

Everything below is inside `ContainerScope.app`, so it works offline once installed:

| Component | Version | Used for |
|---|---|---|
| Apple `container` engine | 1.5.0 | Containers, Linux machines, Kubernetes. Apple's own signed build, unmodified |
| Linux kernel (Kata Containers build) | 6.18.35 | The kernel every container and Linux VM boots |
| QEMU and swtpm | 11.1.2 / 0.10.2 | Windows on ARM VMs and their TPM 2.0 |
| UEFI firmware (Ubuntu AAVMF) | Ubuntu 24.04 | Secure Boot for Windows, with Microsoft's keys and the ContainerScope boot logo |

If you already have Apple's `container` installed (for example with Homebrew), ContainerScope uses yours instead of the bundled copy. See [Third-party notices](THIRD_PARTY_NOTICES.md) for licences and source code.

## Documentation

**Using ContainerScope**

- [Getting started](docs/user/getting-started.md) — install, first launch, requirements, where your data lives
- [Containers, Linux VMs and orchestration](docs/user/containers-linux-orchestration.md) — containers, images, Linux machines, Kubernetes, Docker API and Vagrant
- [Windows on ARM](docs/user/windows-on-arm.md) — create a Windows 11 VM, install it and add the VirtIO drivers
- [Troubleshooting](docs/user/troubleshooting.md)
- [Uninstalling](docs/user/uninstall.md)

**Working on ContainerScope**

- [Architecture](docs/developer/architecture.md) — how the app is put together
- [Building](docs/developer/building.md) — build the app and DMG from source
- [Bundled dependencies](docs/developer/dependencies.md) — what's bundled, how it's fetched, pinned and updated
- [Releasing](docs/developer/releasing.md) — signing, notarization and publishing

## Contributing

Bug reports, ideas and pull requests are welcome. Read the [contributing guide](CONTRIBUTING.md) first, and follow the [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, use [private vulnerability reporting](SECURITY.md), not a public issue.

Quick start for developers (Apple silicon, macOS 26, Xcode 26 or its Command Line Tools):

```sh
git clone https://github.com/ayoinc/ContainerScope.git && cd ContainerScope
brew install qemu swtpm            # QEMU and swtpm are copied out of Homebrew into the bundle
Scripts/fetch-deps.sh              # engine, kernel, QEMU and firmware into build/deps
Scripts/build-app.sh               # build/ContainerScope.app
open build/ContainerScope.app
```

See [Building](docs/developer/building.md) for details.

## Licence

ContainerScope is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Ayodele Ajayi; see [NOTICE](NOTICE).

The components bundled in the app keep their own licences (Apache-2.0, GPL-2.0, LGPL, BSD and others). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists them and explains where to get their source code.

ContainerScope is an independent project and is not affiliated with Apple or Microsoft.
