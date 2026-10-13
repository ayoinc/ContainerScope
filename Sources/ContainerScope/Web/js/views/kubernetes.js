"use strict";
CS.views = CS.views || {};

/* Kubernetes on Apple container (`container k8s`): kind node images + containerd, no Docker engine. */
CS.views.kubernetes = function kubernetes(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  let host = null;
  let selected = null;     // node container id whose workloads are shown
  let workloads = null;    // { nodes, pods } | { error }
  let timer = null;

  const field = (label, control) => h("label", { class: "field" }, h("span", {}, label), control);
  const name = h("input", { type: "text", value: "k8s-dev", "aria-label": "Cluster name" });
  const cpus = h("input", { type: "number", min: 2, max: 64, value: 4, "aria-label": "CPUs" });
  const memory = h("input", { type: "text", value: "4G", "aria-label": "Memory" });
  const createButton = ui.button("Create Cluster", { icon: "play", kind: "prominent", onClick: () => create() });
  const createStatus = h("div");
  const prereqSlot = h("div");
  const listSlot = h("div");
  const workloadSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    prereqSlot,
    h("section", {},
      ui.sectionHeader("New Cluster", "Single-node kind cluster running containerd inside an Apple container VM"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "form-grid" }, field("Name", name), field("CPUs", cpus), field("Memory", memory), h("div", { class: "row" }, createButton)),
        createStatus)),
    h("section", {}, ui.sectionHeader("Clusters"), listSlot),
    workloadSlot));

  function renderPrereqs() {
    const items = [];
    if (host && host.rosetta !== "installed") {
      items.push(h("div", { class: "callout warning banner" },
        h("div", { class: "text" }, h("strong", {}, "Rosetta for Linux is required"),
          host.rosetta === "notSupported" ? "This Mac can't run Rosetta, so clusters can't start." : "Cluster nodes boot with Rosetta enabled for x86-64 images. macOS asks for consent to install it."),
        host.rosetta === "notInstalled" ? ui.button("Install Rosetta…", { kind: "prominent", onClick: async (e) => {
          if ((await CS.act(e.currentTarget, "installRosetta", {}, "Rosetta installed")).ok) { host = await CS.json("hostInfo"); renderPrereqs(); }
        } }) : null));
    }
    const health = store.health.default;
    if (health && health.verdict === "blocked") {
      items.push(h("div", { class: "callout warning banner" },
        h("div", { class: "text" }, h("strong", {}, `Pods can't pull images: ${health.summary}`), health.fix || health.detail),
        ui.button("Network Health", { kind: "plain", onClick: () => CS.app.navigate("engine") })));
    }
    prereqSlot.replaceChildren(...items);
    prereqSlot.hidden = !items.length;
  }

  async function create() {
    const params = { id: name.value.trim(), cpus: Number(cpus.value) || undefined, memory: memory.value.trim() };
    if (!params.id) { name.focus(); return; }
    createStatus.replaceChildren(h("div", { class: "row secondary" }, h("div", { class: "spinner" }), `Creating ${params.id} — pulling the node image (~1 GB the first time) and bootstrapping…`));
    const result = await CS.act(createButton, "k8sCreate", params, `Cluster ${params.id} created`);
    createStatus.replaceChildren(result.ok ? "" : h("pre", { class: "console", style: { color: "var(--red)" } }, result.error));
    store.loadK8s();
  }

  function render() {
    if (store.errors.k8s && !store.data.k8s) { listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.k8s))); return; }
    if (!store.data.k8s) { listSlot.replaceChildren(ui.loading()); return; }
    const rows = store.data.k8s;
    if (!rows.length) { listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "No clusters", "Create one above, then point kubectl at it with Write kubeconfig."))); return; }
    const images = (store.data.images || []).map((i) => i.configuration.name).filter((n) => !n.startsWith("untagged"));
    ui.showTable(listSlot, ui.table([
      { title: "Cluster", width: "14%", render: (r) => h("span", { class: "primary-cell" }, r.cluster) },
      { title: "Node", width: "16%", render: (r) => [h("span", { class: "mono" }, r.node), h("span", { class: "sub" }, r.role)] },
      { title: "State", width: "10%", render: (r) => ui.status(r.state) },
      { title: "Resources", width: "14%", render: (r) => `${r.cpus} CPU · ${r.memory}` },
      { title: "API", width: "16%", render: (r) => h("span", { class: "mono" }, r.ports || "—"), tooltip: (r) => r.addr },
      {
        title: "", width: "30%", className: "actions",
        render: (r) => {
          const load = h("select", { "aria-label": `Load image into ${r.cluster}`, style: { maxWidth: "150px" } },
            h("option", { value: "" }, "Load image…"), images.map((n) => h("option", { value: n }, n)));
          load.onchange = async () => {
            if (!load.value) return;
            await CS.act(null, "k8sLoadImage", { id: r.cluster, ref: load.value }, `Loaded ${load.value} into ${r.cluster}`);
            load.value = "";
          };
          return h("div", { class: "row" },
            r.state === "running" ? load : null,
            r.state === "running" ? ui.iconButton("stack", `Show workloads in ${r.cluster}`, () => { selected = r.node; loadWorkloads(); }) : null,
            ui.iconButton("copy", `Write kubeconfig for ${r.cluster} to ~/.kube/config`, (e) => CS.act(e.currentTarget, "k8sWriteConfig", { id: r.cluster }, "kubeconfig written to ~/.kube/config")),
            ui.iconButton("trash", `Delete cluster ${r.cluster}`, async (e) => { if ((await CS.act(e.currentTarget, "k8sDelete", { id: r.cluster }, `Deleted ${r.cluster}`)).ok) { if (selected === r.node) { selected = null; renderWorkloads(); } store.loadK8s(); } }));
        },
      },
    ], rows, { rowKey: (r) => `${r.cluster}/${r.node}` }));
    if (!selected) {
      const running = rows.find((r) => r.state === "running");
      if (running) { selected = running.node; loadWorkloads(); }
    }
  }

  async function loadWorkloads() {
    if (!selected) return;
    try {
      const [nodes, pods] = await Promise.all([CS.json("k8sGet", { id: selected, kind: "nodes" }), CS.json("k8sGet", { id: selected, kind: "pods" })]);
      workloads = { nodes: nodes.items || [], pods: pods.items || [] };
    } catch (error) {
      workloads = { error: String(error?.message || error) };
    }
    renderWorkloads();
  }

  function renderWorkloads() {
    if (!selected || !workloads) { workloadSlot.replaceChildren(); return; }
    if (workloads.error) {
      workloadSlot.replaceChildren(h("section", {}, ui.sectionHeader("Workloads", selected), h("div", { class: "group" }, ui.empty("warning", "Couldn't query the cluster", workloads.error))));
      return;
    }
    const ready = (n) => (n.status?.conditions || []).find((c) => c.type === "Ready")?.status === "True";
    const podReady = (p) => { const s = p.status?.containerStatuses || []; return `${s.filter((c) => c.ready).length}/${s.length || p.spec?.containers?.length || 0}`; };
    const restarts = (p) => (p.status?.containerStatuses || []).reduce((n, c) => n + (c.restartCount || 0), 0);
    const podSlot = h("div");
    workloadSlot.replaceChildren(h("section", {},
      ui.sectionHeader("Workloads", `via kubectl inside ${selected}`, ui.iconButton("refresh", "Refresh workloads", () => loadWorkloads(), "")),
      h("div", { class: "stack-tight" },
        h("div", { class: "group" }, h("dl", { class: "kv" }, workloads.nodes.flatMap((n) => [
          h("dt", {}, n.metadata.name),
          h("dd", { class: "row" }, h("span", { class: `status ${ready(n) ? "running" : "error"}` }, ready(n) ? "Ready" : "Not Ready"),
            h("span", { class: "secondary" }, `${n.status?.nodeInfo?.kubeletVersion || ""} · ${n.status?.nodeInfo?.containerRuntimeVersion || ""} · ${n.status?.nodeInfo?.osImage || ""}`)),
        ]))),
        podSlot)));
    ui.showTable(podSlot, ui.table([
      { title: "Namespace", width: "18%", render: (p) => h("span", { class: "secondary" }, p.metadata.namespace) },
      { title: "Pod", width: "38%", render: (p) => h("span", { class: "mono" }, p.metadata.name) },
      { title: "Ready", width: "10%", render: (p) => podReady(p) },
      { title: "Status", width: "14%", render: (p) => ui.status(p.status?.phase === "Running" ? "running" : p.status?.phase === "Pending" ? "starting" : p.status?.phase === "Failed" ? "error" : "stopped") },
      { title: "Restarts", align: "right", width: "10%", render: (p) => restarts(p) },
      { title: "Age", align: "right", width: "10%", render: (p) => fmt.duration(p.metadata.creationTimestamp) },
    ], workloads.pods, { rowKey: (p) => p.metadata.uid }));
  }

  CS.json("hostInfo").then((info) => { host = info; renderPrereqs(); }).catch(() => {});
  if (!store.health.default && store.natNetworks().includes("default")) store.diagnose("default");
  render(); renderPrereqs();
  timer = setInterval(() => { if (!document.hidden && selected) loadWorkloads(); }, 10000);

  return {
    update(topic) { if (topic === "k8s" || topic === "images") render(); if (topic === "health") renderPrereqs(); },
    destroy() { clearInterval(timer); },
  };
};
