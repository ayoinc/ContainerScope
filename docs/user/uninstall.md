# Uninstalling ContainerScope

Removing the app is enough to uninstall ContainerScope. Your containers, images, Linux machines and Windows VMs stay on disk until you delete them, so you can reinstall later and pick up where you left off.

## 1. Stop everything

1. Shut down your Windows VMs (**Virtualization › Windows on ARM**).
2. Stop the engine: **System › Engine › Services › Stop**. If ContainerScope is using its bundled engine, this matters: the engine's background service runs from inside the app, so stop it before you delete the app.

   Or in Terminal:
   ```sh
   /Applications/ContainerScope.app/Contents/Resources/Engine/bin/container system stop
   ```
3. Quit ContainerScope.

## 2. Remove the app

Drag **ContainerScope** from Applications to the Bin.

That's all most people need. The bundled engine, kernel, QEMU and firmware were inside the app, so they're gone too.

## 3. Optional: delete your data

> [!WARNING]
> These commands permanently delete your containers, images, volumes, Linux machines, Kubernetes clusters and Windows VMs. Copy anything you want to keep first.

**Windows VMs, firmware and downloaded ISOs** (ContainerScope's own data):

```sh
rm -rf ~/Library/Application\ Support/ContainerScope
rm -rf "$TMPDIR/ContainerScope-ISO"
```

**Engine data** — containers, images, volumes, networks, Linux machines, Kubernetes clusters and kernels. This folder belongs to Apple's `container` engine. If you also use `container` from Homebrew or Apple's installer, it uses the same folder, so only delete it if you're done with containers altogether:

```sh
rm -rf ~/Library/Application\ Support/com.apple.container
```

**App settings and web view data:**

```sh
defaults delete dev.containerscope.app
rm -rf ~/Library/Caches/dev.containerscope.app ~/Library/WebKit/dev.containerscope.app ~/Library/HTTPStorages/dev.containerscope.app
```

**Kubernetes credentials.** If you used **Write kubeconfig**, ContainerScope added its clusters to `~/.kube/config`. Remove them with `kubectl config delete-context`, `kubectl config delete-cluster` and `kubectl config delete-user`, or edit the file.

## Things ContainerScope didn't install

ContainerScope doesn't remove software you installed yourself. If you no longer need them:

- Apple `container` from Homebrew: `brew uninstall container`. If you installed it with Apple's installer package, run `/usr/local/bin/uninstall-container.sh -k` (keeps your data) or `-d` (deletes it).
- socktainer, Docker CLI and Docker Compose: `brew uninstall socktainer docker docker-compose`.
- Rosetta 2 is part of macOS and is used by other apps; leave it installed.
