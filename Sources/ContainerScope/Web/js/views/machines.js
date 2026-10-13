"use strict";
CS.views = CS.views || {};

/* Machines: persistent Linux VMs (`container machine`), including nested virtualization. */
CS.views.machines = function machines(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  const probes = {};          // machine id → probe result | { error } | "running"
  let host = null;
  let kernelPath = "";

  const field = (label, control, wide) => h("label", { class: `field${wide ? " wide" : ""}` }, h("span", {}, label), control);
  const name = h("input", { type: "text", placeholder: "dev-vm", "aria-label": "Machine name" });
  const image = h("input", { type: "text", class: "mono", value: "docker.io/library/ubuntu:24.04", "aria-label": "Image" });
  const cpus = h("input", { type: "number", min: 1, max: 64, value: 4, "aria-label": "CPUs" });
  const memory = h("input", { type: "text", value: "4G", "aria-label": "Memory" });
  const homeMount = h("select", { "aria-label": "Home directory mount" },
    [["rw", "Read/write"], ["ro", "Read-only"], ["none", "Not mounted"]].map(([v, t]) => h("option", { value: v }, t)));
  const nested = h("input", { type: "checkbox" });
  const nestedLabel = h("label", { class: "check" }, nested, "Nested virtualization");
  const kernelLabel = h("span", { class: "secondary truncate" }, "Default kernel");
  const createButton = ui.button("Create Machine", { icon: "play", kind: "prominent", onClick: () => create() });
  const createStatus = h("div");
  const listSlot = h("div");
  const probeSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    h("section", {},
      ui.sectionHeader("New Machine", "A persistent Linux VM booted from an OCI image"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "form-grid" },
          field("Name", name), field("Image", image, true), field("CPUs", cpus), field("Memory", memory), field("Home folder", homeMount)),
        h("div", { class: "row wrap" },
          nestedLabel,
          h("span", { class: "spacer" }),
          kernelLabel,
          ui.button("Kernel…", { kind: "plain", title: "Use a custom kernel (needed for KVM inside the guest)", onClick: async (e) => {
            const pick = await CS.act(e.currentTarget, "kernelChoose", {});
            if (pick.ok) { kernelPath = pick.out; kernelLabel.textContent = kernelPath.split("/").pop(); kernelLabel.title = kernelPath; }
          } }),
          createButton),
        createStatus)),
    h("section", {}, h("div", { class: "section-header" }, h("h2", {}, "Machines"), h("span", { class: "summary", id: "machines-summary" })), listSlot),
    probeSlot));

  async function create() {
    const params = {
      id: name.value.trim(), ref: image.value.trim(), cpus: Number(cpus.value) || undefined,
      memory: memory.value.trim(), homeMount: homeMount.value, virtualization: nested.checked, kernel: kernelPath,
    };
    if (!params.id) { name.focus(); return; }
    createStatus.replaceChildren(h("div", { class: "row secondary" }, h("div", { class: "spinner" }), `Creating ${params.id} — pulling the image and booting…`));
    const result = await CS.act(createButton, "machineCreate", params, `Machine ${params.id} created`);
    createStatus.replaceChildren(result.ok ? "" : h("pre", { class: "console", style: { color: "var(--red)" } }, result.error));
    if (result.ok) { name.value = ""; store.load("machines"); }
  }

  async function act(button, method, id, done) {
    const result = await CS.act(button, method, { id }, done);
    if (result.ok) store.load("machines");
    return result;
  }

  async function probe(id) {
    probes[id] = "running"; renderProbes();
    try { probes[id] = await CS.json("machineProbe", { id }); } catch (error) { probes[id] = { error: String(error?.message || error) }; }
    renderProbes();
  }

  function render() {
    const summary = document.getElementById("machines-summary");
    if (store.errors.machines && !store.data.machines) { listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.machines))); return; }
    if (!store.data.machines) { listSlot.replaceChildren(ui.loading()); return; }
    const all = store.data.machines;
    if (summary) summary.textContent = `${all.filter((m) => m.status === "running").length} running · ${all.length} total`;
    if (!all.length) { listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "No machines", "Create one above — Ubuntu, Debian, Fedora, or any OCI image with an init system."))); return; }
    ui.showTable(listSlot, ui.table([
      { title: "Name", width: "22%", render: (m) => [h("span", { class: "primary-cell" }, m.id, m.default ? h("span", { class: "badge accent", style: { marginLeft: "6px" } }, "Default") : null), h("span", { class: "sub" }, ui.status(m.status))] },
      { title: "Address", width: "15%", render: (m) => h("span", { class: "mono" }, m.ipAddress || "—") },
      { title: "Resources", width: "17%", render: (m) => `${m.cpus} CPU · ${fmt.bytes(m.memory, 0)}` },
      { title: "Disk", align: "right", width: "10%", render: (m) => fmt.bytes(m.diskSize) },
      { title: "Created", width: "13%", render: (m) => h("span", { class: "secondary" }, fmt.relative(m.createdDate)), tooltip: (m) => fmt.date(m.createdDate) },
      {
        title: "", width: "23%", className: "actions",
        render: (m) => {
          const running = m.status === "running";
          return h("div", { class: "row" },
            running
              ? ui.iconButton("stop", `Stop ${m.id}`, (e) => act(e.currentTarget, "machineStop", m.id, `Stopped ${m.id}`))
              : ui.iconButton("play", `Boot ${m.id}`, (e) => act(e.currentTarget, "machineBoot", m.id, `Booted ${m.id}`)),
            ui.iconButton("terminal", `Open shell in ${m.id}`, (e) => CS.act(e.currentTarget, "machineShell", { id: m.id })),
            ui.iconButton("bolt", `Check nested virtualization in ${m.id}`, () => probe(m.id)),
            m.default ? null : ui.iconButton("box", `Make ${m.id} the default machine`, (e) => act(e.currentTarget, "machineSetDefault", m.id, `${m.id} is now the default`)),
            ui.iconButton("trash", `Delete ${m.id}`, (e) => act(e.currentTarget, "machineDelete", m.id, `Deleted ${m.id}`)));
        },
      },
    ], all, { className: "tall", rowKey: (m) => m.id }));
  }

  function renderProbes() {
    const ids = Object.keys(probes);
    if (!ids.length) { probeSlot.replaceChildren(); return; }
    probeSlot.replaceChildren(h("section", {},
      ui.sectionHeader("Nested Virtualization", "Guest needs EL2 from the host hypervisor and a kernel with KVM"),
      h("div", { class: "stack-tight" }, ids.map((id) => {
        const r = probes[id];
        if (r === "running") return h("div", { class: "group row secondary" }, h("div", { class: "spinner" }), `Probing ${id}…`);
        if (r.error) return h("div", { class: "group" }, h("strong", {}, id), h("p", { style: { color: "var(--red)" } }, r.error));
        const ready = r.el2 && r.kvmDevice;
        return h("div", { class: "group stack-tight" },
          h("div", { class: "row" }, h("strong", {}, id), h("span", { class: `verdict ${ready ? "ok" : "blocked"}` }, ready ? "KVM ready" : "KVM unavailable"),
            h("div", { class: "spacer" }), ui.button("Re-check", { kind: "plain", onClick: () => probe(id) })),
          h("div", { class: "checks" },
            h("span", { class: `check ${r.el2 ? "pass" : "fail"}` }, h("span", {}, r.el2 ? "✓" : "✕"), " CPU started at EL2"),
            h("span", { class: `check ${r.kvmDevice ? "pass" : "fail"}` }, h("span", {}, r.kvmDevice ? "✓" : "✕"), " /dev/kvm present"),
            h("span", { class: "secondary mono" }, `kernel ${r.kernel}`)),
          !r.el2 ? h("div", { class: "callout warning" }, "Nested virtualization is off for this machine. Stop it, then: ", h("code", {}, `container machine set --name ${id} virtualization=true`),
            " — or toggle it here.", " ", ui.button("Enable", { kind: "plain", onClick: async (e) => { if ((await CS.act(e.currentTarget, "machineSet", { id, key: "virtualization", value: true }, "Nested virtualization enabled — restart the machine")).ok) store.load("machines"); } }))
            : !r.kvmDevice ? h("div", { class: "callout warning" }, "EL2 is available but this kernel was built without KVM. Choose a kernel built with CONFIG_KVM=y (Apple's containerization kernel config has it) and restart the machine. ",
              ui.button("Choose Kernel…", { kind: "plain", onClick: async (e) => {
                const pick = await CS.act(e.currentTarget, "kernelChoose", {});
                if (pick.ok && (await CS.act(e.currentTarget, "machineSet", { id, key: "kernel", value: pick.out }, "Kernel set — restart the machine")).ok) store.load("machines");
              } }))
              : h("p", { class: "secondary" }, "Run KVM guests (QEMU/KVM, Firecracker, kind-in-VM, Vagrant libvirt) inside this machine."),
          r.kvmLog ? h("pre", { class: "console" }, r.kvmLog) : null);
      }))));
  }

  CS.json("hostInfo").then((info) => {
    host = info;
    nested.disabled = !host?.nestedVirtualization;
    nestedLabel.title = host?.nestedVirtualization ? "Expose EL2 to the guest (Apple M3 or later)" : "Requires Apple M3 or later and macOS 15+";
  }).catch(() => {});

  render();
  return { update(topic) { if (topic === "machines") render(); }, destroy() {} };
};
