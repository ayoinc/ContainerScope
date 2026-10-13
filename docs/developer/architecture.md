# Architecture

ContainerScope is a small native macOS app. A SwiftUI shell (window, sidebar, toolbar, menus) hosts a single `WKWebView` that renders the content of every page. The web page never talks to the system directly: it calls an allow-listed bridge, and Swift runs the bundled tools with argument vectors (never a shell).

```
┌──────────────────────────── ContainerScope.app ─────────────────────────────┐
│  SwiftUI: window, sidebar, toolbar, menus           (ContentView, AppModel) │
│  ┌──────────────────────── WKWebView (Web/) ────────────────────────────┐  │
│  │ index.html → core.js · store.js · charts.js · views/*.js · app.js   │  │
│  └────────────── webkit.messageHandlers.bridge.postMessage ─────────────┘  │
│  Bridge.swift: allow-listed methods, validated params, native confirmations │
│     │               │                    │                    │             │
│  ContainerCLI    WindowsVMs          Compose          NetworkHealth, HostInfo│
│     │            MicrosoftISO           │                                   │
└─────┼───────────────┼───────────────────┼───────────────────────────────────┘
      ▼               ▼                   ▼
  `container`     qemu-system-aarch64   docker compose → socktainer (optional,
  (bundled or      + swtpm (bundled)     Docker Engine API on the container engine)
   user-installed)
```

## Source layout

| Path | What it is |
|---|---|
| `Package.swift` | SwiftPM package: one executable target, macOS 26. The `Web/` folder is excluded from the Swift build and copied into the bundle by `Scripts/build-app.sh`. |
| `Sources/ContainerScope/ContainerScopeApp.swift` | `@main`; the window scene and menu commands (Refresh, ⌘1…⌘9 routes, Appearance). |
| `ContentView.swift` | `NavigationSplitView`: native sidebar, toolbar status indicator, the web view as the detail column. |
| `AppModel.swift` | App state: current `Route`, sidebar sections, appearance, engine status polling for the native chrome. |
| `WebController.swift` | Owns the `WKWebView`; loads `Web/index.html` from the bundle, opens external links in the browser, reloads if the WebKit content process dies. |
| `Bridge.swift` | JS → Swift RPC. Every method the page can call is a `case` in one `switch`. |
| `ContainerCLI.swift` | Finds the `container` CLI, runs it with a timeout, starts the engine services. |
| `Bundled.swift` | Paths to the components inside `Contents/Resources` (engine, kernel, QEMU, firmware, versions manifest). |
| `WindowsVMs.swift` | Windows on ARM VMs: firmware expansion, VM folders, swtpm + QEMU launch, QEMU monitor, ISO downloads. |
| `MicrosoftISO.swift` | Gets official Windows 11 ARM64 download links by driving Microsoft's download page in a hidden, non-persistent web view. |
| `Compose.swift` | Docker Compose against socktainer's socket (Orchestration page). |
| `NetworkHealth.swift` | Diagnoses why a container network can't reach the internet (including known VPN kill switches). |
| `HostInfo.swift` | Host facts for the UI: macOS version, chip capabilities (nested virtualization), Rosetta, latest engine release. |
| `Web/` | The UI: `index.html`, `css/` (design tokens and components), `js/core.js` (bridge, DOM builder, formatting, icons, toasts), `js/store.js` (polling and history), `js/charts.js`, `js/views/*.js` (one per page), `js/app.js` (router). |
| `Scripts/` | Dependency staging, build, DMG and release scripts. See [Building](building.md) and [Releasing](releasing.md). |
| `Firmware/` | `build-aavmf.sh` (Secure Boot UEFI recipe) and `Logo.png` (boot logo). |
| `Artwork/` | Logo and icon sources, `render.sh`. |

## Native shell and web content

The sidebar is native (`Route.sections` in `AppModel.swift`: **Containers**, **Virtualization**, **System**), so it follows macOS conventions (selection, badges, keyboard shortcuts, Liquid Glass). Selecting a route tells the page to navigate; the page can also navigate (for example from an Overview card) and the bridge mirrors that back into the sidebar.

The web page is a plain, build-step-free set of scripts loaded from `file://` with a strict Content Security Policy (`default-src 'none'`, scripts and styles only from the bundle). There's no framework and no npm. Each view in `js/views/` is a factory that renders into `#app` and returns an object with `destroy()`; `CS.store` polls the bridge, keeps a few minutes of history for charts, and notifies views by topic.

## The bridge

The page calls:

```js
const text = await CS.call("containers");          // resolves with CLI stdout
const json = await CS.json("status");               // same, parsed as JSON
```

which posts `{ method, params }` to the `bridge` script message handler. `Bridge` is a `WKScriptMessageHandlerWithReply`, so each call resolves with a string or rejects with an error message.

Rules the bridge enforces, and that new methods must follow:

- **Allow-list only.** Unknown methods fail. There's no generic "run this command" method.
- **Validate before argv.** Identifiers, image references, sizes and file paths go through the `Params` helpers (`id()`, `memory()`, `existingFile()`, …) before they reach an argument list. Commands run through `Process` with an argument array; nothing goes through a shell.
- **Confirm natively.** Destructive actions (delete, kill, prune, stop services, upgrade, power off a VM, …) show an `NSAlert` from Swift, so a page bug or injected script can't skip the prompt.
- **External links open in the browser.** Only `https` URLs are opened, and the web view itself never navigates away from the bundled page.

## Finding the engine

`ContainerCLI` resolves the `container` CLI in this order and uses the first executable it finds:

1. `CONTAINER_BIN` environment variable
2. `/opt/homebrew/bin/container` (Homebrew), `/usr/local/bin/container` (Apple's installer, or Homebrew on Intel paths; a resolved path under `/Cellar/` is treated as Homebrew)
3. `container` anywhere on `PATH`
4. The bundled engine, `Contents/Resources/Engine/bin/container`

So a user who already has the engine keeps using it, and everyone else gets the bundled one. The source is shown on the Engine page and decides what "update" means: Homebrew engines can be upgraded in-app; the bundled engine updates with ContainerScope.

Starting services:

- **User-installed engine:** `container system start --disable-kernel-install`.
- **Bundled engine:** `container system start --install-root <app>/Contents/Resources/Engine --disable-kernel-install`. The engine registers its launchd services pointing into the app bundle, so this refuses to run from the DMG (`/Volumes/…`) or an App Translocation path. Starting again after the app has moved re-points the services. If there's no default kernel yet (`kernels/default.kernel-arm64` under the engine's data root), the app sets the bundled kernel with `container system kernel set --binary … --force`, avoiding the engine's ~700 MB Kata download.

All engines share one launchd label, so only one can run at a time. Engine data lives in `~/Library/Application Support/com.apple.container` regardless of which engine is used.

## Windows on ARM

`WindowsVMs` runs each VM as a `qemu-system-aarch64` process with Hypervisor.framework acceleration:

- **Firmware.** The bundle ships Ubuntu's Secure Boot AAVMF images (`AAVMF_CODE.ms.fd`, `AAVMF_VARS.ms.fd`) with trailing zero padding trimmed. On first use they're copied to `~/Library/Application Support/ContainerScope/Firmware`, padded back to 64 MiB and stamped with the firmware `VERSION`; a new version replaces them atomically. Each VM gets its own copy of the variable store (`vars.fd`).
- **TPM.** `swtpm socket --tpm2` runs per VM with its state in the VM's `tpm/` folder and exits when QEMU disconnects.
- **Machine.** `virt` machine, `-accel hvf -cpu host`, NVMe system disk (inbox Windows driver), USB keyboard/tablet, `ramfb` display for setup or `virtio-gpu-pci` after the VirtIO display driver is installed, VirtIO network (user-mode networking), install ISOs as USB mass storage, a QEMU monitor socket for shutdown and power off, and a Cocoa window.
- **Signing.** QEMU needs the `com.apple.security.hypervisor` entitlement (`Scripts/qemu.entitlements`); `build-app.sh` signs it with ContainerScope's identity.
- **Media.** ISOs download to `$TMPDIR/ContainerScope-ISO` with `URLSession`; the Windows page offers a clean-up button once setup is done.

VM folders live in `~/Library/Application Support/ContainerScope/Windows/<name>` (`disk.qcow2`, `vars.fd`, `tpm/`, `vm.json`, `media.txt`, `qemu.log`).

## Data and state

ContainerScope keeps very little state of its own: the engine is the source of truth for containers, images, machines and clusters, and the app asks it every time. Its own state is the Windows VM folders, the expanded firmware, downloaded ISOs, and a few user defaults (appearance) under `dev.containerscope.app`.

## Bundled components

What's inside `Contents/Resources`, where each piece comes from, and how to update it is in [Bundled dependencies](dependencies.md).
