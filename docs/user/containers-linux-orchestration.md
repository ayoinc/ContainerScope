# Containers, Linux VMs and orchestration

ContainerScope is a front end for Apple's `container` engine. Each container runs in its own lightweight Linux virtual machine, booted from the kernel that ships with ContainerScope. This guide covers the **Containers** and **Virtualization › Linux** parts of the sidebar, plus the Docker API and Vagrant.

If you haven't opened ContainerScope yet, start with [Getting started](getting-started.md).

## Overview

**Containers › Overview** is the dashboard:

- **Activity** — CPU, memory and network for all running containers over the last few minutes.
- **Running Containers** — what's running now; **Show All** opens the Containers page.
- **Disk Usage** — space used by images, containers and volumes.
- **Network health** — whether containers can reach DNS and the internet. **Re-test** runs the checks again; **Details** opens the full report on the Engine page.
- **Requirements** — a banner for each requirement tagged **Needs attention** (for example, running the app from the disk image instead of Applications), with a button to the full **Requirements** list on the Engine page.

## Containers

**Containers › Containers** lists every container with its state, image, address, CPU and memory. Click a container to open it. The detail view has four tabs:

| Tab | What it shows |
|---|---|
| Overview | Live CPU, memory and network graphs, and the container's configuration (image, command, resources, mounts, ports) |
| Processes | The processes inside the container (`ps`), and **Run Command** for one-off, non-interactive commands |
| Logs | The container's output, with a copy button |
| Inspect | The raw `container inspect` JSON |

Buttons at the top of the detail view:

- **Start** / **Stop** — start or stop the container.
- **Shell** — opens Terminal with an interactive shell inside the container.
- **Kill** — sends `SIGKILL` to a container that won't stop.
- **Delete** — removes the container.

ContainerScope shows and manages containers; you create them with the `container` command (see [Using the command line](getting-started.md#using-the-container-command-line)). For example:

```sh
container run -d --name web -p 8080:80 docker.io/library/nginx:latest
```

`web` appears in ContainerScope straight away.

### x86-64 (Intel) images

Apple silicon runs `arm64` images natively. To run `amd64` images, install **Rosetta 2** (Engine › Requirements) and pass `--platform linux/amd64` (or `--arch amd64`) when you run the container.

## Images, volumes and networks

- **Images** — every image on the engine, its platform, size and digest. **Pull** downloads an image by reference (for example `docker.io/library/alpine:latest`). **Prune** removes dangling images. The trash button deletes an image.
- **Volumes** — named volumes, their size and which containers use them. Delete a volume with the trash button.
- **Networks** — the engine's networks with their subnets and gateway, and which containers are attached. Network health checks run against the default network.

## Linux virtual machines

**Virtualization › Linux** creates persistent Linux virtual machines with `container machine`. Unlike a container, a machine keeps its disk between boots, runs its own init system, and can mount your home folder, so it behaves like a normal Linux computer.

### Create a machine

1. Open **Virtualization › Linux**.
2. Enter a name, for example `dev`.
3. Pick a distribution: Ubuntu, Debian, Fedora or Alpine, or enter any OCI image that includes an init system (for example `docker.io/library/ubuntu:24.04`).
4. Set CPUs and memory (for example `4` and `4G`).
5. Choose how your home folder is shared: read/write, read-only, or not mounted.
6. Optional: turn on **Nested virtualization** (see below) or choose a custom kernel.
7. Create the machine. ContainerScope pulls the image and boots it; the first boot takes longer because of the download.

### Use a machine

Each machine in the list has buttons to:

- boot or stop it;
- open a shell in Terminal;
- check nested virtualization;
- make it the **default** machine (the one `container machine` commands use when you don't name one);
- delete it.

From Terminal, the same machine is available with `container machine`:

```sh
container machine run --name dev uname -a
```

### Nested virtualization

On Apple M3 or later, a machine can run its own virtual machines (KVM, Firecracker, kind-in-a-VM, Vagrant with libvirt). It needs two things:

1. **Nested virtualization** turned on for the machine (EL2 exposed to the guest). You can turn it on when you create the machine, or later: stop the machine, then use the **Enable** button in the check results, or run `container machine set --name dev virtualization=true`.
2. A kernel built with KVM (`CONFIG_KVM=y`). If the check reports that `/dev/kvm` is missing, choose a kernel built with KVM and restart the machine.

The check button runs both tests inside the machine and reports **KVM ready** or what's missing. On M1 and M2 the option is greyed out because the hardware doesn't support it.

## Orchestration

**Containers › Orchestration** runs container orchestrators on the engine. The first one is **Kubernetes**, using `container k8s`: single-node [kind](https://kind.sigs.k8s.io/) clusters running containerd inside an Apple container VM. There's no Docker engine involved.

### Before you start

- **Rosetta 2** must be installed: cluster nodes boot with Rosetta enabled for x86-64 images. If it's missing, the page shows a banner with an install button. macOS asks you to agree to the Rosetta licence.
- Containers must be able to reach the internet to pull images. If the network health check fails, the page shows a banner with a link to **Network Health**.

### Create a cluster

1. Enter a cluster name (default `k8s-dev`), CPUs (at least 2) and memory (for example `4G`).
2. Create the cluster. The first time, it pulls the node image (about 1 GB) and bootstraps Kubernetes.

### Work with a cluster

Select a cluster to see its **nodes** and **pods** (namespace, status, restarts, age). For each cluster you can:

- **Load an image** from the engine into the cluster, so pods can use an image you built locally without pushing it to a registry.
- **Write kubeconfig** — merges the cluster's credentials into `~/.kube/config`, so `kubectl` works:
  ```sh
  kubectl get nodes
  kubectl create deployment hello --image=docker.io/library/nginx:latest
  ```
- **Delete** the cluster.

### Docker Compose

Orchestration can also run [Docker Compose](https://docs.docker.com/compose/) projects on the engine, through socktainer's Docker API. It needs the Docker CLI with the Compose plugin and a running socktainer (see [Set up socktainer](#set-up-socktainer)):

```sh
brew install docker docker-compose socktainer
brew services start socktainer
```

Until both are found, the page shows these setup steps instead of the projects. Once they are:

- **Bring a project up** by choosing its `compose.yaml` or `docker-compose.yml`. ContainerScope runs `docker compose up -d` with the file's folder as the project directory. The project's containers then also appear in **Containers › Containers**.
- Select a project to see its services and their state.
- **Start**, **stop** or **restart** a project, or take it **down**. Down removes the project's containers and networks after you confirm; named volumes are kept.

## Docker API and Vagrant

Apple's engine doesn't speak the Docker Engine API. [socktainer](https://github.com/socktainer/socktainer) adds it, so the Docker CLI, Docker Compose and Vagrant's docker provider can use ContainerScope's engine without Docker Desktop. socktainer isn't bundled; install it yourself.

### Set up socktainer

1. Install it:
   ```sh
   brew install socktainer
   ```
2. Start it as described in its documentation (for example with `brew services start socktainer`).
3. Open **System › Engine** and scroll to **Docker API & Vagrant**. When ContainerScope finds the socket it shows **socktainer detected** and the line to export. The socket is at one of:
   - `~/.socktainer/container.sock`
   - `/opt/homebrew/var/run/socktainer/.socktainer/container.sock`
   - `/usr/local/var/run/socktainer/.socktainer/container.sock`
4. Point Docker clients at it, using the path shown on the Engine page:
   ```sh
   export DOCKER_HOST=unix://$HOME/.socktainer/container.sock
   docker ps
   ```

### Vagrant with the docker provider

Vagrant's docker provider runs a container on ContainerScope's engine through socktainer. Tested with Vagrant 2.4.9 and socktainer 1.5.3.

1. Install Vagrant and socktainer, and start socktainer:
   ```sh
   brew install --cask vagrant
   brew install socktainer && brew services start socktainer
   ```
2. In a new folder, create a `Vagrantfile` (the **Docker API & Vagrant** section of the Engine page has a copy button for it):
   ```ruby
   Vagrant.configure("2") do |config|
     config.vm.provider "docker" do |d|
       d.image = "docker.io/library/ubuntu:24.04"
       d.cmd = ["sleep", "infinity"]
       d.has_ssh = false
     end
   end
   ```
3. In the same Terminal window, point Vagrant at socktainer (with Homebrew's `brew services`, the socket is here; the Engine page shows the exact path) and bring the container up:
   ```sh
   export DOCKER_HOST=unix:///opt/homebrew/var/run/socktainer/.socktainer/container.sock
   vagrant up --provider=docker
   ```
   The container appears in **Containers › Containers**, and the folder with the `Vagrantfile` is shared into it at `/vagrant`.
4. Run commands in it with `vagrant docker-exec`:
   ```sh
   vagrant docker-exec -- uname -a
   ```
5. When you're done:
   ```sh
   vagrant destroy -f
   ```

`vagrant ssh` doesn't work with this setup: the stock Ubuntu image has no SSH server, so `d.has_ssh = false` tells Vagrant not to wait for one. Use `vagrant docker-exec` instead. `sleep infinity` keeps the container running. For a Vagrant VM with full virtualization (the libvirt provider), use a Linux machine with [nested virtualization](#nested-virtualization) instead.

## More help

- [Troubleshooting](troubleshooting.md)
- Apple `container` documentation: <https://github.com/apple/container/tree/main/docs>
