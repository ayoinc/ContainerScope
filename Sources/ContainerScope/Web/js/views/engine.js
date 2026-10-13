"use strict";
CS.views = CS.views || {};

/* Engine: service lifecycle, updates, container network health, host virtualization, kernel, Docker API. */
CS.views.engine = function engine(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  let versions = null, latest = null, latestError = null, host = null;

  const slots = { requirements: h("div"), services: h("div"), updates: h("div"), health: h("div"), host: h("div"), kernel: h("div"), docker: h("div") };
  root.replaceChildren(h("div", { class: "stack" },
    h("section", {}, slots.requirements),
    h("div", { class: "grid cols-2" }, slots.services, slots.updates),
    h("section", {}, slots.health),
    h("div", { class: "grid cols-2" }, slots.host, slots.kernel),
    h("section", {}, slots.docker)));

  /* Included in the app vs what the user provides, with the one-click fixes the app can do itself. */
  function renderRequirements() {
    if (!host) { slots.requirements.replaceChildren(ui.sectionHeader("Requirements"), ui.loading()); return; }
    const items = CS.requirements(host);
    const included = items.filter((r) => r.state === "included").length;
    slots.requirements.replaceChildren(
      ui.sectionHeader("Requirements", `${included} included in ContainerScope · ${items.filter((r) => r.state === "action").length} you provide`),
      h("div", { class: "group requirements" }, items.map((r) => h("div", { class: "requirement" },
        h("strong", {}, r.name),
        h("div", { class: "row" },
          r.install ? ui.button("Install Rosetta…", { kind: "plain", onClick: async (e) => { if ((await CS.act(e.currentTarget, "installRosetta", {}, "Rosetta installed")).ok) refreshHost(); } }) : null,
          r.route ? ui.button("Open", { kind: "plain", onClick: () => CS.app.navigate(r.route) }) : null,
          h("span", { class: `tag ${r.state}` }, CS.requirementLabel[r.state])),
        h("div", { class: "detail" }, r.detail)))));
  }

  const versionOf = (name) => versions?.find((v) => v.appName === name)?.version;
  const semver = (v) => (v || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

  async function serviceAction(button, method, done) {
    const result = await CS.act(button, method, {}, done);
    if (result.ok) await refreshVersions();
    renderServices();
  }

  function renderServices() {
    const running = store.data.status?.status === "running";
    slots.services.replaceChildren(
      ui.sectionHeader("Services"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "row" },
          h("span", { class: `status ${running ? "running" : "stopped"}` }, running ? "Running" : "Stopped"),
          h("span", { class: "secondary" }, running ? `apiserver ${versionOf("container-apiserver") || store.data.status?.server?.version || ""}` : (store.errors.status || "container-apiserver is not responding"))),
        h("dl", { class: "kv" },
          h("dt", {}, "Engine"), h("dd", {}, { bundled: "Bundled with ContainerScope", homebrew: "Homebrew", installer: "Apple's installer", custom: "CONTAINER_BIN", path: "From PATH" }[host?.engine?.source] || "—"),
          h("dt", {}, "CLI"), h("dd", {}, versionOf("container") || store.data.status?.client?.version || "—"),
          h("dt", {}, "Install root"), h("dd", { class: "mono" }, store.data.status?.paths?.installRoot || "—"),
          h("dt", {}, "Data"), h("dd", { class: "mono" }, store.data.status?.paths?.appRoot || "—")),
        h("div", { class: "row" },
          running
            ? ui.button("Restart", { icon: "refresh", onClick: (e) => serviceAction(e.currentTarget, "servicesRestart", "Services restarted") })
            : ui.button("Start Services", { icon: "power", kind: "prominent", onClick: (e) => serviceAction(e.currentTarget, "servicesStart", "Services started") }),
          running ? ui.button("Stop", { icon: "stop", kind: "destructive", onClick: (e) => serviceAction(e.currentTarget, "servicesStop", "Services stopped") }) : null)));
  }

  function renderUpdates() {
    const installed = versionOf("container") || store.data.status?.client?.version;
    const available = latest?.tag;
    const source = host?.engine?.source;
    const outdated = installed && available && newer(available, installed);
    slots.updates.replaceChildren(
      ui.sectionHeader("Updates"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "metric" },
          h("div", { class: "label" }, "Installed"),
          h("div", { class: "value" }, installed ? `v${installed}` : "—"),
          h("div", { class: "detail" }, latestError ? `Couldn't check GitHub: ${latestError}`
            : !available ? "Checking github.com/apple/container…"
              : outdated ? `v${available.replace(/^v/, "")} available · released ${fmt.relative(latest.publishedAt)}`
                : `Up to date · latest is ${available} (${fmt.relative(latest.publishedAt)})`)),
        h("div", { class: "row" },
          outdated && source === "homebrew" ? ui.button(`Upgrade to ${available}`, { icon: "download", kind: "prominent", onClick: async (e) => {
            const result = await CS.act(e.currentTarget, "engineUpgrade", {}, "Engine upgraded");
            if (result.ok) { await refreshVersions(); store.refreshAll(); }
          } }) : null,
          outdated && source === "bundled" ? h("span", { class: "secondary" }, "The bundled engine updates with ContainerScope. Get the latest ContainerScope release.") : null,
          outdated && source && source !== "homebrew" && source !== "bundled" ? h("span", { class: "secondary" }, "Installed from the signed .pkg — download the new installer from GitHub.") : null,
          latest?.url ? ui.button("Release Notes", { kind: "plain", onClick: () => CS.call("openURL", { url: latest.url }) }) : null,
          ui.button("Check Again", { kind: "plain", onClick: () => refreshLatest() }))));
  }

  const verdictLabel = { ok: "Online", blocked: "Blocked", isolated: "Private", hostOffline: "Host offline", error: "Error" };

  function healthCard(id) {
    const r = store.health[id];
    const busy = store.diagnosing.has(id);
    const network = (store.data.networks || []).find((n) => n.id === id);
    return h("div", { class: `group health ${r?.verdict || ""}` },
      h("div", { class: "row" },
        h("strong", {}, id),
        h("span", { class: "badge" }, (network?.configuration.mode || r?.mode || "").toUpperCase()),
        r ? h("span", { class: `verdict ${r.verdict}` }, verdictLabel[r.verdict] || r.verdict) : null,
        h("div", { class: "spacer" }),
        busy ? h("span", { class: "row secondary" }, h("div", { class: "spinner" }), "Testing…") : null,
        r?.canRestart ? ui.button("Restart Services", { icon: "refresh", onClick: async (e) => { if ((await CS.act(e.currentTarget, "servicesRestart", {}, "Services restarted")).ok) store.diagnose(id); } }) : null,
        ui.button(r ? "Re-test" : "Test", { icon: "network", disabled: busy, onClick: () => store.diagnose(id) })),
      r ? h("div", { class: "health-body" },
        h("div", { class: "health-summary" }, r.summary),
        h("p", { class: "secondary" }, r.detail),
        r.fix ? h("div", { class: "callout warning" }, h("strong", {}, "Fix: "), r.fix) : null,
        r.verdict !== "isolated" ? h("div", { class: "checks" },
          check("Host internet", r.hostOnline),
          r.dns !== undefined ? check("Container DNS", r.dns) : null,
          r.egress !== undefined ? check("Container egress", r.egress) : null,
          h("span", { class: "secondary" }, `Route via ${r.routeInterface || "?"}${r.vpn ? ` · ${r.vpn}` : ""} · checked ${fmt.relative(r.checkedAt)}`)) : null)
        : h("p", { class: "secondary" }, busy ? "Starting a throwaway probe container on this network…" : "Not tested yet."));
  }

  function check(label, ok) {
    return h("span", { class: `check ${ok ? "pass" : "fail"}` }, h("span", { "aria-hidden": "true" }, ok ? "✓" : "✕"), ` ${label}`);
  }

  function renderHealth() {
    const networks = store.data.networks || [];
    slots.health.replaceChildren(
      ui.sectionHeader("Network Health", "NAT networks should reach the internet; --internal networks are private by design"),
      networks.length
        ? h("div", { class: "stack-tight" }, networks.map((n) => n.configuration.mode === "nat" ? healthCard(n.id)
          : h("div", { class: "group health isolated" }, h("div", { class: "row" }, h("strong", {}, n.id), h("span", { class: "badge" }, n.configuration.mode.toUpperCase()), h("span", { class: "verdict isolated" }, "Private")),
            h("p", { class: "secondary" }, "Host-only network: containers reach each other and the host, not the internet."))))
        : ui.loading());
  }

  function renderHost() {
    const rosetta = { installed: "Installed", notInstalled: "Not installed", notSupported: "Not supported" }[host?.rosetta] || "—";
    slots.host.replaceChildren(
      ui.sectionHeader("Virtualization"),
      h("div", { class: "group" }, host ? h("dl", { class: "kv" },
        h("dt", {}, "Chip"), h("dd", {}, `${host.chip} · ${host.cpus} cores · ${fmt.bytes(host.memoryBytes, 0)}`),
        h("dt", {}, "macOS"), h("dd", {}, host.macOS),
        h("dt", {}, "Hypervisor"), h("dd", {}, check("Hypervisor.framework", host.hypervisor)),
        h("dt", {}, "Nested virtualization"), h("dd", {}, check(host.nestedVirtualization ? "Supported (EL2 exposed to guests)" : "Not supported (needs M3 or later)", host.nestedVirtualization)),
        h("dt", {}, "Rosetta for Linux"), h("dd", { class: "row" }, check(rosetta, host.rosetta === "installed"),
          host.rosetta === "notInstalled" ? ui.button("Install…", { kind: "plain", title: "Required by Kubernetes clusters and x86-64 images", onClick: async (e) => {
            if ((await CS.act(e.currentTarget, "installRosetta", {}, "Rosetta installed")).ok) refreshHost();
          } }) : null)) : ui.loading()));
  }

  function renderKernel() {
    const k = store.data.properties?.kernel;
    const m = store.data.properties?.machine;
    slots.kernel.replaceChildren(
      ui.sectionHeader("Guest Kernel"),
      h("div", { class: "group stack-tight" },
        h("dl", { class: "kv" },
          h("dt", {}, "Default"), h("dd", { class: "mono" }, k?.binaryPath || "—"),
          h("dt", {}, "Source"), h("dd", { class: "mono secondary" }, k?.url || "Local file"),
          h("dt", {}, "Machine defaults"), h("dd", {}, m ? `${m.cpus} CPUs · ${m.memory} · home ${m.homeMount} · nested virt ${m.virtualization ? "on" : "off"}` : "—")),
        h("p", { class: "secondary" }, "Nested KVM inside a guest needs a kernel built with CONFIG_KVM=y. Pick one per machine, or set it as the default here."),
        h("div", { class: "row" },
          ui.button("Choose Kernel…", { onClick: async (e) => {
            const pick = await CS.act(e.currentTarget, "kernelChoose", {});
            if (pick.ok && (await CS.act(e.currentTarget, "kernelSetDefault", { path: pick.out }, "Default kernel set")).ok) store.load("properties");
          } }),
          ui.button("Use Recommended", { kind: "plain", onClick: async (e) => { if ((await CS.act(e.currentTarget, "kernelRecommended", {}, "Recommended kernel installed")).ok) store.load("properties"); } }))));
  }

  function renderDocker() {
    const socket = host?.dockerSocket;
    const vagrantfile = `Vagrant.configure("2") do |config|
  config.vm.provider "docker" do |d|
    d.image = "docker.io/library/ubuntu:24.04"
    d.cmd = ["sleep", "infinity"]
    d.has_ssh = false
  end
end`;
    const env = socket ? `export DOCKER_HOST=unix://${socket}` : "";
    const commands = `vagrant up --provider=docker
vagrant docker-exec -- uname -a
vagrant destroy -f`;
    slots.docker.replaceChildren(
      ui.sectionHeader("Docker API & Vagrant", socket ? "socktainer detected" : "No Docker API socket found"),
      h("div", { class: "group stack-tight" },
        socket
          ? h("p", {}, "socktainer serves the Docker Engine API on top of Apple container, so Docker CLIs, Compose, and Vagrant's docker provider work without Docker Desktop.")
          : h("p", { class: "secondary" }, "Install socktainer (brew install socktainer) to expose a Docker Engine API backed by Apple container."),
        socket ? copyBlock(env) : null,
        socket ? h("p", { class: "secondary" }, "Vagrantfile using the docker provider (run with DOCKER_HOST exported):") : null,
        socket ? copyBlock(vagrantfile) : null,
        socket ? h("p", { class: "secondary" }, "Then run these in the same shell. The image has no SSH server (has_ssh = false), so use vagrant docker-exec rather than vagrant ssh:") : null,
        socket ? copyBlock(commands) : null));
  }

  function copyBlock(text) {
    return h("div", { class: "copy-block" },
      h("pre", { class: "console" }, text),
      ui.iconButton("copy", "Copy", () => { navigator.clipboard.writeText(text); CS.toast("Copied"); }, ""));
  }

  async function refreshVersions() { versions = await CS.json("version").catch(() => null); renderServices(); renderUpdates(); }
  async function refreshLatest() {
    latest = null; latestError = null; renderUpdates();
    try { latest = await CS.json("latestRelease"); } catch (error) { latestError = String(error?.message || error); }
    renderUpdates();
  }
  async function refreshHost() { host = await CS.json("hostInfo").catch(() => null); renderRequirements(); renderServices(); renderUpdates(); renderHost(); renderDocker(); }

  renderRequirements(); renderServices(); renderUpdates(); renderHealth(); renderHost(); renderKernel(); renderDocker();
  refreshVersions(); refreshLatest(); refreshHost();
  for (const id of store.natNetworks()) if (!store.health[id]) store.diagnose(id);

  return {
    update(topic) {
      if (topic === "status") { renderServices(); renderUpdates(); }
      if (topic === "health" || topic === "networks") renderHealth();
      if (topic === "properties") renderKernel();
    },
    destroy() {},
  };
};
