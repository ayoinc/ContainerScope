# Getting started

ContainerScope runs Linux containers, Linux virtual machines, Kubernetes clusters and Windows 11 on ARM virtual machines on your Mac. Everything it needs to do that is inside the app.

## What you need

- A Mac with **Apple silicon** (M1 or later). Intel Macs aren't supported.
- **macOS 26** or later.
- About 520 MB of disk space for the app (the download is about 200 MB), plus space for the images, machines and VMs you create. A Windows VM needs 64 GB by default (the disk grows as Windows uses it).

Some things ContainerScope can't ship. The **Requirements** section of **System › Engine** lists everything ContainerScope needs and tags each item: **Included** (bundled in the app), **Ready** (already on your Mac), **You provide** (a step for you, with a link to where to do it), **Optional** or **Needs attention** (missing and blocking something). Overview shows a banner only for items that need attention. The things you provide:

| Requirement | Needed for | How to get it |
|---|---|---|
| Rosetta 2 | Kubernetes clusters and x86-64 (Intel) container images | Part of macOS. Click **Install Rosetta…** next to Rosetta in Engine › Requirements, or on the Orchestration page |
| Windows 11 ARM64 ISO | Windows on ARM VMs | Microsoft's licence doesn't allow bundling it. ContainerScope downloads it from Microsoft's official links on the Windows on ARM page |
| VirtIO driver ISO (~880 MB) | Network and display drivers inside Windows | Downloaded on the Windows on ARM page from the Fedora project |
| Container images | Running containers, Linux machines | Pulled from registries (Docker Hub, GitHub Container Registry, …) when you use them |
| socktainer (optional) | Docker CLI, Docker Compose and Vagrant against ContainerScope's engine | `brew install socktainer`. See [Docker API and Vagrant](containers-linux-orchestration.md#docker-api-and-vagrant) |

## Install

1. Download `ContainerScope-<version>.dmg` from the [latest release](https://github.com/ayoinc/ContainerScope/releases/latest). It's about 200 MB.
2. Optional: check the download against the `.sha256` file from the same release:
   ```sh
   cd ~/Downloads
   shasum -a 256 -c ContainerScope-<version>.dmg.sha256
   ```
3. Open the DMG and drag **ContainerScope** to **Applications**.
4. Eject the DMG and open ContainerScope from Applications or Launchpad.

Releases are signed with a Developer ID and notarized by Apple, so macOS opens them without a warning.

## First launch

On first launch ContainerScope:

1. **Picks an engine.** If Apple's `container` is already installed on your Mac (in `/opt/homebrew/bin` or `/usr/local/bin`), ContainerScope uses it. Otherwise it uses the copy of Apple's `container` 1.5.0 inside the app. Either way there's nothing to install and no administrator password.
2. **Starts the engine services.** The toolbar shows **Running · v1.5.0** once they're up. If they're stopped, the toolbar shows **Start Services**.
3. **Installs the Linux kernel** that containers boot, if you don't have one yet. The kernel is in the app (30 MB), so this takes seconds instead of the 697 MB download the engine would otherwise do.

Then you land on **Overview**.

## Finding your way around

The sidebar has three sections:

- **Containers**
  - **Overview** — live activity, running containers, disk usage and engine health.
  - **Containers**, **Images**, **Volumes**, **Networks** — everything the engine manages.
  - **Orchestration** — Kubernetes clusters and Docker Compose projects.
- **Virtualization**
  - **Linux** — persistent Linux virtual machines.
  - **Windows on ARM** — Windows 11 virtual machines.
- **System**
  - **Engine** — engine status, updates, kernels, requirements, Docker API and Vagrant.

Keyboard shortcuts:

| Shortcut | Action |
|---|---|
| ⌘R | Refresh |
| ⌘1 … ⌘9 | Jump to a sidebar page, top to bottom |

**View › Appearance** switches between System, Light and Dark.

Next:

- [Containers, Linux VMs and orchestration](containers-linux-orchestration.md)
- [Windows on ARM](windows-on-arm.md)

## Using the `container` command line

ContainerScope and the `container` command work on the same engine, so anything you create in one shows up in the other.

- If you installed `container` yourself, use it as usual.
- If ContainerScope is using its bundled engine, the command is inside the app. To use it in Terminal:
  ```sh
  alias container=/Applications/ContainerScope.app/Contents/Resources/Engine/bin/container
  container list --all
  ```

## Where your data lives

| What | Where |
|---|---|
| Containers, images, volumes, networks, Linux machines, Kubernetes clusters, kernels | `~/Library/Application Support/com.apple.container` |
| Windows VMs (disk, TPM state, settings) and the expanded Secure Boot firmware | `~/Library/Application Support/ContainerScope` |
| Downloaded Windows and VirtIO ISOs | A temporary folder (`$TMPDIR/ContainerScope-ISO`). **Clean Up** on the Windows on ARM page deletes them |

The engine data folder is the same one Apple's `container` uses on its own, so switching between ContainerScope's bundled engine and a Homebrew one keeps your containers and images.

## Updating

- **ContainerScope** — download the new DMG from [Releases](https://github.com/ayoinc/ContainerScope/releases) and replace the app in Applications. The **Engine** page shows when a newer engine release exists.
- **Bundled engine, kernel, QEMU and firmware** — updated with ContainerScope. You don't update them separately.
- **Engine installed with Homebrew** — upgrade it from the **Engine** page, or with `brew upgrade container`.

Quit running containers and VMs before you replace the app. Your data stays where it is.

## Only one engine at a time

macOS can run only one `container` engine at a time, because every copy registers the same background service. If you have both a Homebrew engine and ContainerScope's bundled one, ContainerScope uses the Homebrew one. To switch to the bundled engine, stop the services (**Engine** › **Stop**) and uninstall the other engine (`brew uninstall container`), then restart ContainerScope.
