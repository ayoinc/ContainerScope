# Changelog

All notable changes to ContainerScope are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Self-contained app bundle. ContainerScope now ships with everything it needs to run, so there's nothing to install with Homebrew and no administrator password:
  - Apple's signed `container` engine 1.5.0 (CLI, API server and plugins, including machines and Kubernetes), run in place from the app bundle;
  - the Linux kernel that containers boot (Kata Containers 3.32.0 build, Linux 6.18.35), installed on first start so the engine doesn't download 697 MB;
  - QEMU 11.1.2 and swtpm 0.10.2 with their libraries, signed with ContainerScope's Developer ID;
  - Secure Boot UEFI firmware (Ubuntu's AAVMF with the Microsoft keys enrolled and the ContainerScope boot logo).
- An engine you installed yourself (Homebrew, `/usr/local/bin/container` or `CONTAINER_BIN`) is used instead of the bundled one.
- **Requirements** list on the Engine page that tags each item **Included**, **Ready**, **You provide**, **Optional** or **Needs attention**: the bundled engine, kernel, QEMU and firmware, Apple silicon and macOS 26, Rosetta 2, Windows install media, VirtIO drivers, container images and the optional Docker API (socktainer). Overview shows a banner for items that need attention.
- Windows VMs: **VirtIO GPU** display option for a resizable display once the VirtIO drivers are installed in Windows.
- Linux VMs: choose from 11 distributions (Ubuntu 24.04/22.04, Debian 13/12, Fedora, Rocky Linux 10/9, AlmaLinux 10/9, openSUSE Leap 15.6, Alpine 3.22), each prepared once with an init system and passwordless sudo, or any OCI image. Create waits until the new machine accepts commands.
- Windows on ARM: install media from Microsoft, Windows Insider Preview, a direct link, an ISO on disk or UUP dump; VirtIO drivers from the stable or latest channel with copyable install commands for all drivers or only the display driver; per-VM networking (NAT, NAT with port forwarding on 127.0.0.1, or isolated).
- Orchestration: Docker Compose projects (up, start, stop, restart, down) on the engine through socktainer's Docker API.
- Docker API and Vagrant guide: Vagrant's docker provider on top of socktainer.
- User guides and developer documentation in [`docs/`](docs).
- Community files: [contributing guide](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
- Release builds publish a tarball of the source code of the bundled GPL/LGPL components next to the DMG.

### Changed

- Sidebar reorganised into **Containers** (Overview, Containers, Images, Volumes, Networks, Orchestration), **Virtualization** (Linux, Windows on ARM) and **System** (Engine).
- Kubernetes moved to **Orchestration**, which is built to host more orchestration engines; `container k8s` clusters are the first.
- **Machines** is now **Linux**, and **Windows** is now **Windows on ARM**.
- ContainerScope is now licensed under the [Apache License 2.0](LICENSE).
- The DMG is about 200 MB because it includes the engine, kernel, QEMU and firmware.

### Removed

- **Install QEMU** (Homebrew) and **Get Secure Boot Firmware** buttons on the Windows page. QEMU, swtpm and the firmware are bundled.
- The requirement to install Apple `container` separately.

## [0.1.0] - 2026-10-13

First public release.

### Added

- Dashboard for Apple's `container` engine: Overview with live activity and disk usage, Containers (with Overview, Processes, Logs and Inspect tabs, Shell and Run Command), Images, Volumes and Networks with network health checks.
- Machines: persistent Linux VMs (`container machine`), including nested virtualization on Apple M3 or later.
- Kubernetes: create clusters on the engine, see nodes and pods, load images and write a kubeconfig.
- Windows 11 on ARM virtual machines on QEMU + Hypervisor.framework: UEFI Secure Boot, swtpm TPM 2.0, NVMe disk, VirtIO network, official Microsoft ISO downloads and Fedora VirtIO driver downloads.
- Engine page: status, start/stop/restart, upgrades, kernel management and Rosetta install.
- Signed and notarized DMG published on GitHub Releases.

[Unreleased]: https://github.com/ayoinc/ContainerScope/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ayoinc/ContainerScope/releases/tag/v0.1.0
