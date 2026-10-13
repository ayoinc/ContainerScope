# Windows on ARM

**Virtualization › Windows on ARM** runs Windows 11 for ARM64 in a virtual machine. The VM runs on QEMU with Apple's Hypervisor.framework, so Windows runs at native speed on the Mac's CPU. Windows 11's own x64 emulation runs most Intel Windows apps inside it.

Everything the VM needs from ContainerScope is in the app: QEMU, a software TPM 2.0 (swtpm) and Secure Boot UEFI firmware with Microsoft's keys. You only bring Windows itself, which ContainerScope downloads for you.

## What a VM gets

| Part | What it is |
|---|---|
| CPU | Your Mac's CPU, through Hypervisor.framework (default 4 cores) |
| Memory | Default 8 GB |
| Disk | NVMe, default 64 GB. The file grows as Windows uses space |
| Firmware | UEFI with **Secure Boot** on and Microsoft's keys enrolled, ContainerScope boot logo |
| TPM | TPM 2.0 (swtpm), as Windows 11 requires |
| Network | VirtIO network adapter (needs the VirtIO driver) |
| Display | Basic display (`ramfb`) for setup, or **VirtIO GPU** once the driver is installed |
| Input | USB keyboard and tablet (the mouse follows the pointer without capturing it) |

The VM opens in its own QEMU window.

## 1. Get the installer media

Downloads go to a temporary folder (`$TMPDIR/ContainerScope-ISO`). You can delete them once Windows is installed (see [Clean up](#5-clean-up)).

### Windows 11 ARM64

ContainerScope supports several ways to provide the Windows installer:

- **Download from Microsoft (recommended).** Pick the Windows version and language; the list comes straight from Microsoft's Windows 11 Arm64 download page. ContainerScope asks Microsoft for a signed, time-limited download link and downloads the official ISO (about 5–6 GB). This is the same file you'd get from <https://www.microsoft.com/software-download/windows11arm64>.
- **Use a link.** If you already have a download link (for example from Microsoft's page in your browser), paste it and ContainerScope downloads it.
- **Use an ISO on disk.** If you already have a Windows 11 ARM64 ISO, choose it from Finder. ContainerScope uses it in place.

If Microsoft refuses the automatic download (it sometimes rate-limits or blocks requests), the page offers a button to open Microsoft's download page in your browser. Download it there and use the ISO on disk.

You need a valid Windows licence to activate Windows. ContainerScope doesn't provide one.

### VirtIO drivers

Download the **VirtIO drivers** ISO (about 880 MB) from the same page. It comes from the Fedora project's [virtio-win](https://github.com/virtio-win/virtio-win-pkg-scripts) builds and contains the drivers Windows needs for:

- the **network** adapter;
- the **display** (VirtIO GPU, `viogpudo`), for a resizable screen;
- memory ballooning and other VirtIO devices.

Downloads show their progress and can be cancelled.

## 2. Create the VM

1. Enter a name, for example `win11`.
2. Set CPUs (at least 2), memory in GB and disk size in GB. 4 CPUs, 8 GB and 64 GB are good defaults.
3. Choose the network option for the VM.
4. Create the VM. ContainerScope creates its disk and TPM in `~/Library/Application Support/ContainerScope/Windows/<name>`.

The first time you create or start a VM, ContainerScope expands the bundled Secure Boot firmware into `~/Library/Application Support/ContainerScope/Firmware`.

## 3. Install Windows

1. In the installer media list, tick the Windows ISO and the VirtIO ISO, then start the VM. The checked media are attached as USB drives and the Windows ISO is the boot disk.
2. A QEMU window opens with the ContainerScope logo. When it says **Press any key to boot from CD or DVD**, click into the window and press a key. If you miss it, shut the VM down and start it again.
3. Follow Windows Setup. The disk shows up without extra drivers because it's NVMe.
4. **Network during setup.** Windows has no network driver yet, so Setup may insist on an internet connection. Press **Shift+F10**, type `OOBE\BYPASSNRO`, press Return, and after the restart choose **I don't have internet**.
5. Finish setup and sign in.

## 4. Install the VirtIO drivers

After the first sign-in:

1. Open **Terminal (Admin)** (right-click Start).
2. Find the VirtIO CD's drive letter in File Explorer (usually `E:`), then run, with that letter:
   ```bat
   pnputil /add-driver E:\*\w11\ARM64\*.inf /subdirs /install
   ```
   This installs every ARM64 driver on the disc: network, display, balloon and the rest. Don't use `virtio-win-guest-tools.exe` on that disc; it's x64-only and won't install on ARM.
3. The network comes up. Run Windows Update.
4. Shut down Windows.
5. Switch the VM's display to **VirtIO GPU**. You can only change the display while the VM is shut down.
6. Start the VM again. The window can now be resized and Windows follows its size.

With the basic display (`ramfb`) the screen has a fixed size; resizing the window only scales the picture.

## 5. Clean up

Once Windows is installed, detach the ISOs and start the VM without media. Then use **Clean Up** to delete the downloaded ISOs from the temporary folder. macOS also clears that folder on its own over time, so download them again if you need them later.

## Day to day

- **Start** a VM to open its window.
- **Shut down** sends the ACPI power button, so Windows shuts down cleanly. **Power off** is like pulling the plug; use it only if Windows is stuck.
- **Delete** removes the VM's folder: its disk, TPM state and settings. The VM must be shut down first.
- The log button shows the VM's QEMU log; it's the first place to look if a VM won't start.

Changing a VM's display or deleting it requires the VM to be shut down.

## Files

Each VM is a folder in `~/Library/Application Support/ContainerScope/Windows/<name>`:

| File | Contents |
|---|---|
| `disk.qcow2` | The Windows disk |
| `vars.fd` | UEFI variables: Secure Boot keys and boot entries for this VM |
| `tpm/` | TPM 2.0 state (BitLocker keys and Windows Hello live here; keep it with the disk) and `swtpm.log` |
| `vm.json` | CPUs, memory, disk size, display |
| `media.txt` | The ISOs attached at the last start |
| `qemu.log` | QEMU output |

To back up a VM, shut it down and copy its folder.

## Limits

- Windows 11 for ARM64 only. x64 Windows ISOs don't boot.
- No GPU acceleration (3D, DirectX) and no sound.
- No shared folders or shared clipboard between macOS and Windows.
- Nested virtualization inside Windows (WSL 2, Hyper-V) isn't supported.

See [Troubleshooting](troubleshooting.md#windows-on-arm) if something goes wrong.
