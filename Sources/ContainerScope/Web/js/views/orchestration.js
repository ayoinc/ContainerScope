"use strict";
CS.views = CS.views || {};

/* Orchestration: multi-container engines on Apple container. Kubernetes first, then Docker Compose via socktainer. */
CS.views.orchestration = function orchestration(root) {
  const { h, ui } = CS;
  const engines = [["kubernetes", "Kubernetes"], ["compose", "Docker Compose"]];
  const factories = { kubernetes: kubernetesEngine, compose: composeEngine };
  const slot = h("div");
  let current = null;

  root.replaceChildren(h("div", { class: "stack" },
    h("div", { class: "row" }, ui.segmented(engines, orchestration.engine, (key) => mount(key), "Orchestration engine")),
    slot));

  function mount(key) {
    current?.destroy();
    orchestration.engine = key;
    current = factories[key](slot);
  }

  mount(orchestration.engine);
  return {
    update(topic) { current?.update(topic); },
    destroy() { current?.destroy(); },
  };
};
CS.views.orchestration.engine = "kubernetes"; // remembered across visits while the page lives

/* Kubernetes on Apple container (`container k8s`): kind node images + containerd, no Docker engine. */
function kubernetesEngine(root) {
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
}

/*
  Docker Compose through socktainer, which serves the Docker Engine API on top of Apple container.
  Projects and their services are real Apple containers; nothing here runs without the socket.
*/
function composeEngine(root) {
  const { h, ui } = CS;
  const defaultSocket = "/opt/homebrew/var/run/socktainer/.socktainer/container.sock";
  let status = null;        // composeStatus result
  let projects = null;      // [{ Name, Status, ConfigFiles }] | { error }
  let selected = null;      // project name whose services are shown
  let services = null;      // [ps rows] | { error }
  let alive = true;
  let timer = null;

  const setupSlot = h("div");
  const projectSlot = h("div");
  const serviceSlot = h("div");
  root.replaceChildren(h("div", { class: "stack" }, setupSlot, projectSlot, serviceSlot));

  const ready = () => status && status.docker && status.compose && status.socket;
  const stateOf = (text = "") => {
    const s = text.split("(")[0].trim().toLowerCase();
    return s === "running" ? "running" : s === "restarting" ? "starting" : s === "dead" ? "error" : "stopped";
  };
  /* `compose ps --format json` prints one object per line (older releases: one array). */
  const parseLines = (text) => {
    const t = text.trim();
    if (!t) return [];
    if (t.startsWith("[")) return JSON.parse(t);
    return t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  };

  function copyBlock(text) {
    return h("div", { class: "copy-block" },
      h("pre", { class: "console" }, text),
      ui.iconButton("copy", "Copy", () => { navigator.clipboard.writeText(text); CS.toast("Copied"); }, ""));
  }

  function renderSetup() {
    if (!status) { setupSlot.replaceChildren(ui.loading("Checking Docker Compose…")); return; }
    const socket = status.socket || defaultSocket;
    const env = `export DOCKER_HOST=unix://${socket}`;
    const check = (ok, text) => h("span", { class: `check ${ok ? "pass" : "fail"}` }, h("span", {}, ok ? "✓" : "✕"), ` ${text}`);
    const steps = [];
    if (!status.socktainer) steps.push("brew install socktainer");
    if (!status.socket) steps.push("brew services start socktainer");
    if (!status.docker) steps.push("brew install docker");
    if (!status.compose) steps.push("brew install docker-compose", "# then add \"cliPluginsExtraDirs\": [\"/opt/homebrew/lib/docker/cli-plugins\"] to ~/.docker/config.json");
    setupSlot.replaceChildren(h("section", {},
      ui.sectionHeader("Docker Compose", ready() ? `Compose ${status.compose} · socktainer` : "Needs socktainer and the Docker CLI with the Compose plugin",
        ui.iconButton("refresh", "Re-check", () => loadStatus(), "")),
      h("div", { class: "group stack-tight" },
        h("p", { class: ready() ? "" : "secondary" }, "socktainer serves the Docker Engine API on top of Apple container, so ", h("code", {}, "docker compose"), " projects run as Apple containers — no Docker Desktop."),
        h("div", { class: "checks" },
          check(!!status.socktainer, "socktainer installed"),
          check(!!status.socket, status.socket ? `socket ${status.socket}` : "socktainer socket running"),
          check(!!status.docker, "Docker CLI"),
          check(!!status.compose, status.compose ? `Compose plugin ${status.compose}` : "Compose plugin")),
        steps.length ? h("p", { class: "secondary" }, "To finish setup, run in Terminal:") : null,
        steps.length ? copyBlock(steps.join("\n")) : null,
        h("p", { class: "secondary" }, "Use Compose from Terminal against the same engine:"),
        copyBlock(env))));
  }

  function renderProjects() {
    if (!ready()) { projectSlot.replaceChildren(); serviceSlot.replaceChildren(); return; }
    const upButton = ui.button("Up from Compose File…", { icon: "play", kind: "prominent", onClick: async (e) => {
      const result = await CS.act(e.currentTarget, "composeUp", {}, "Compose project is up");
      if (result.ok) loadProjects();
    } });
    const listSlot = h("div");
    projectSlot.replaceChildren(h("section", {}, ui.sectionHeader("Projects", projects && !projects.error ? `${projects.length} total` : null, upButton), listSlot));
    if (!projects) { listSlot.replaceChildren(ui.loading()); return; }
    if (projects.error) { listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("warning", "Couldn't list Compose projects", projects.error))); return; }
    if (!projects.length) { listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("stack", "No Compose projects", "Choose a compose.yaml with Up from Compose File…, or run docker compose up with DOCKER_HOST set as above."))); return; }
    const action = (project, verb, title, done) => ui.iconButton(verb === "down" ? "trash" : verb === "stop" ? "stop" : verb === "restart" ? "refresh" : "play", title, async (e) => {
      if ((await CS.act(e.currentTarget, "composeAction", { id: project, action: verb }, done)).ok) {
        if (verb === "down" && selected === project) { selected = null; services = null; }
        loadProjects();
      }
    });
    ui.showTable(listSlot, ui.table([
      { title: "Project", width: "22%", render: (p) => h("span", { class: "primary-cell" }, p.Name) },
      { title: "Status", width: "18%", render: (p) => [ui.status(stateOf(p.Status)), h("span", { class: "sub" }, p.Status)] },
      { title: "Compose File", width: "38%", render: (p) => h("span", { class: "mono secondary truncate" }, p.ConfigFiles || "—"), tooltip: (p) => p.ConfigFiles || "" },
      {
        title: "", width: "22%", className: "actions",
        render: (p) => {
          const running = stateOf(p.Status) === "running";
          return h("div", { class: "row" },
            ui.iconButton("stack", `Show services in ${p.Name}`, () => { selected = p.Name; loadServices(); }),
            running ? action(p.Name, "stop", `Stop ${p.Name}`, `Stopped ${p.Name}`) : action(p.Name, "start", `Start ${p.Name}`, `Started ${p.Name}`),
            action(p.Name, "restart", `Restart ${p.Name}`, `Restarted ${p.Name}`),
            action(p.Name, "down", `Take down ${p.Name} (remove containers and networks)`, `${p.Name} is down`));
        },
      },
    ], projects, { rowKey: (p) => p.Name }));
    if (!selected && projects.length) { selected = projects[0].Name; loadServices(); }
  }

  function renderServices() {
    if (!ready() || !selected || !services) { serviceSlot.replaceChildren(); return; }
    const tableSlot = h("div");
    serviceSlot.replaceChildren(h("section", {},
      ui.sectionHeader("Services", selected, ui.iconButton("refresh", "Refresh services", () => loadServices(), "")), tableSlot));
    if (services.error) { tableSlot.replaceChildren(h("div", { class: "group" }, ui.empty("warning", "Couldn't query the project", services.error))); return; }
    const ports = (s) => (s.Publishers || []).filter((p) => p.PublishedPort).map((p) => `${p.PublishedPort}→${p.TargetPort}/${p.Protocol}`).join(", ") || "—";
    ui.showTable(tableSlot, ui.table([
      { title: "Service", width: "16%", render: (s) => h("span", { class: "primary-cell" }, s.Service) },
      { title: "Container", width: "22%", render: (s) => h("span", { class: "mono" }, s.Name) },
      { title: "Image", width: "26%", render: (s) => h("span", { class: "mono secondary truncate" }, s.Image), tooltip: (s) => s.Image },
      { title: "State", width: "18%", render: (s) => [ui.status(stateOf(s.State)), h("span", { class: "sub" }, s.Status || "")] },
      { title: "Ports", width: "18%", render: (s) => h("span", { class: "mono" }, ports(s)) },
    ], services, { rowKey: (s) => s.ID || s.Name }));
  }

  async function loadStatus() {
    status = null; renderSetup();
    status = await CS.json("composeStatus").catch((error) => ({ error: String(error?.message || error) }));
    if (!alive) return;
    renderSetup();
    if (ready()) loadProjects(); else renderProjects();
  }

  async function loadProjects() {
    try { projects = await CS.json("composeList"); } catch (error) { projects = { error: String(error?.message || error) }; }
    if (!alive) return;
    if (Array.isArray(projects) && selected && !projects.some((p) => p.Name === selected)) { selected = null; services = null; }
    renderProjects();
    if (selected) loadServices();
    else renderServices();
  }

  async function loadServices() {
    if (!selected) return;
    const project = selected;
    try { services = parseLines(await CS.call("composePs", { id: project })); } catch (error) { services = { error: String(error?.message || error) }; }
    if (alive && project === selected) renderServices();
  }

  loadStatus();
  timer = setInterval(() => { if (!document.hidden && ready()) loadProjects(); }, 10000);

  return {
    update() {},
    destroy() { alive = false; clearInterval(timer); },
  };
}
