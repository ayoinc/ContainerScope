# Troubleshooting

Start with **System › Engine**. Its **Requirements** list tags anything missing as **Needs attention**, **Services** shows whether the engine is running, and **Network Health** tests whether containers can reach the internet.

If none of this helps, [open an issue](https://github.com/ayoinc/ContainerScope/issues/new) with your macOS version, Mac model, ContainerScope version (**ContainerScope › About ContainerScope**) and what you see. For Windows VMs, include the VM's QEMU log.

## Installing and opening

### macOS says ContainerScope can't be opened

Release DMGs from [GitHub Releases](https://github.com/ayoinc/ContainerScope/releases) are signed and notarized, so they open normally. If macOS blocks the app:

- Make sure you downloaded it from the Releases page, and check the download with its `.sha256` file (see [Getting started](getting-started.md#install)).
- Builds you made yourself, or CI artifacts, are signed ad hoc. Open them once with right-click › **Open**, or allow them in **System Settings › Privacy & Security**.

### ContainerScope won't run on this Mac

ContainerScope needs a Mac with Apple silicon and macOS 26 or later. Intel Macs and older macOS versions can't run Apple's `container` engine, and macOS won't open the app on versions before 26.

## Engine

### "Move ContainerScope to your Applications folder"

The bundled engine runs from inside the app, so it can't start while ContainerScope is running from the DMG (or from a copy macOS has quarantined in a temporary location). Quit ContainerScope, drag it to Applications, eject the DMG and open it from Applications.

If you move the app later, open it once from its new location; starting the services re-points the engine's background service to the new path.

### The engine won't start

1. On **System › Engine**, use **Start Services** (or **Restart** if it shows as running) under **Services** and wait up to a minute.
2. If it still won't start, check whether another `container` engine is running. Only one engine can run at a time, because every copy registers the same background service. Stop the other one first, for example:
   ```sh
   /opt/homebrew/bin/container system stop
   ```
   then start the services again from ContainerScope.
3. Look at the engine's logs in Terminal (use the bundled engine's path if you don't have `container` installed, see [Using the command line](getting-started.md#using-the-container-command-line)):
   ```sh
   container system logs --last 10m
   ```

### ContainerScope uses my Homebrew engine instead of the bundled one

That's on purpose: if `container` is installed in `/opt/homebrew/bin` or `/usr/local/bin`, or `CONTAINER_BIN` points to one, ContainerScope uses it. To use the bundled engine instead, see [Only one engine at a time](getting-started.md#only-one-engine-at-a-time).

### "The bundled engine updates with ContainerScope"

The engine inside the app can't be upgraded on its own. Download the latest ContainerScope release instead. Engines installed with Homebrew can still be upgraded from the Engine page.

### Containers fail to start with a kernel error

ContainerScope installs its bundled kernel on first start when no default kernel is set. If you removed or changed the default kernel, open **System › Engine › Guest Kernel** and use **Use Recommended** to install the recommended kernel again.

## Containers and images

### Containers can't reach the internet

Run the check under **System › Engine › Network Health**. It tells you which of these it is:

- **Private network.** Networks created with `--internal` are host-only by design. Use the default network, or a NAT network, for internet access.
- **A VPN is blocking local traffic.** Many VPNs have a kill switch that blocks the virtual network containers use (`192.168.64.0/24`). ContainerScope recognises common VPNs (NordVPN, Tailscale, Cloudflare WARP, WireGuard, GlobalProtect, Cisco Secure Client, FortiClient, Zscaler, Proton VPN, Mullvad, ExpressVPN, Surfshark, Tunnelblick) and tells you which setting to change, usually "allow local network access" or turning off the kill switch. Then re-test.
- **Your Mac is offline.** Fix the Mac's own connection first.

Kubernetes clusters, Linux machines and image pulls all need this to work.

### An x86-64 image won't run

Intel images run under Rosetta 2. Install it from the Requirements list on the Engine page (or `softwareupdate --install-rosetta --agree-to-license`), then start the container again.

### Pulling an image fails

- Check the reference, including the registry: `docker.io/library/alpine:latest`, not just `alpine` if the short name doesn't resolve.
- Check that the image has an `arm64` or `amd64` variant.
- Private registries need a login first: `container registry login <registry>`.

## Linux machines

### Nested virtualization shows as unavailable

Nested virtualization needs an Apple M3 or later. On M1 and M2 it's greyed out. On M3 or later, run the check on the machine; it tells you whether to turn the option on (with the machine stopped) or choose a kernel built with KVM. See [Nested virtualization](containers-linux-orchestration.md#nested-virtualization).

## Orchestration

### Creating a Kubernetes cluster fails

- Install Rosetta 2. Cluster nodes boot with Rosetta enabled.
- Make sure containers can reach the internet (see above). The first cluster pulls a node image of about 1 GB.
- Give the cluster at least 2 CPUs and 4 GB of memory.

### Docker Compose shows setup steps instead of projects

ContainerScope needs the Docker CLI with Compose and a running socktainer:

```sh
brew install docker docker-compose socktainer
brew services start socktainer
```

If you started socktainer some other way, make sure its socket is in one of the locations listed in [Set up socktainer](containers-linux-orchestration.md#set-up-socktainer).

## Windows on ARM

The QEMU log is the first place to look: use the log button on the VM's row. The VM's files are in `~/Library/Application Support/ContainerScope/Windows/<name>`.

### Microsoft won't give a download link

Microsoft sometimes rate-limits or blocks automated requests. Wait a minute and try again. If it keeps failing, open Microsoft's download page from the Windows on ARM page, download the ISO in your browser, and add it with the button for an ISO on disk.

### "Download failed" or the ISO disappeared

ISOs are kept in a temporary folder that macOS clears from time to time. Download them again. A download can't start while the same file is already downloading.

### The VM shows the UEFI shell or "No bootable option"

You missed the **Press any key to boot from CD or DVD** prompt, or no Windows ISO was attached. Shut the VM down, make sure the Windows ISO is ticked in the media list, start it again and press a key in the VM window as soon as the prompt appears.

The VM's disk boots before any ISO, so once Windows is on the disk the installer never starts, even with the ISO attached. To install again from scratch, create a new VM.

### Setup says this PC can't run Windows 11

Check that you're using a Windows 11 **ARM64** ISO; x64 ISOs don't boot. ContainerScope provides Secure Boot and TPM 2.0, so they don't need to be bypassed.

### Setup insists on an internet connection

Windows has no network driver until the VirtIO drivers are installed. Press **Shift+F10**, run `OOBE\BYPASSNRO`, and after the restart choose **I don't have internet**. Install the drivers after you sign in (see [Install the VirtIO drivers](windows-on-arm.md#4-install-the-virtio-drivers)).

### No network in Windows

The VirtIO network driver isn't installed. Attach the VirtIO ISO and run the `pnputil` command from [Install the VirtIO drivers](windows-on-arm.md#4-install-the-virtio-drivers). `virtio-win-guest-tools.exe` is x64-only and won't work.

### virtio-win-guest-tools fails with 0x80070643

That installer is x64-only and can't install on Windows on ARM; it rolls back without changing anything. Install the drivers with the PowerShell command from [Install the VirtIO drivers](windows-on-arm.md#4-install-the-virtio-drivers) instead.

### The screen can't be resized

The VM is using the basic display (`ramfb`), which has a fixed size. Install the VirtIO drivers, shut the VM down and switch its display to VirtIO GPU. If Windows shows a black screen after switching, the display driver isn't installed: switch back to the basic display, install the drivers, and try again.

### "Shut down <name> before …"

Changing the display, deleting a VM and deleting an attached ISO all need the VM to be shut down. Use **Shut down** and wait for Windows to finish. If Windows is stuck, use **Power off**.

### "… is missing from the app bundle. Reinstall ContainerScope."

QEMU, swtpm or the firmware is missing from the app, usually because the app was modified or copied incompletely. Download the DMG again and replace the app.

### The VM is slow

Give it at least 4 CPUs and 8 GB of memory, and install the VirtIO drivers. There's no 3D acceleration, so graphics-heavy apps and games will be slow.
