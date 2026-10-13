"use strict";
CS.views = CS.views || {};

CS.views.container = function containerDetail(root, id) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  let tab = "overview";
  let tabState = null;      // { update(topic), destroy() } of the active tab
  let lastState = null;

  const titleSlot = h("div", { class: "detail-title" });
  const actionsSlot = h("div", { class: "row" });
  const tabSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    h("div", { class: "detail-header" },
      ui.iconButton("chevronLeft", "Back to Containers", () => CS.app.navigate("containers")),
      titleSlot,
      h("div", { class: "spacer" }),
      actionsSlot),
    h("div", { class: "row" },
      ui.segmented([["overview", "Overview"], ["processes", "Processes"], ["logs", "Logs"], ["inspect", "Inspect"]], tab, (t) => { tab = t; mountTab(); }, "Container sections")),
    tabSlot));

  const container = () => store.containerById(id);

  function renderHeader() {
    const c = container();
    if (!c) {
      titleSlot.replaceChildren(h("h1", {}, id), h("span", { class: "sub" }, store.data.containers ? "This container no longer exists." : "Loading…"));
      actionsSlot.replaceChildren();
      return;
    }
    const state = c.status?.state;
    titleSlot.replaceChildren(
      h("h1", { class: "truncate" }, c.id),
      h("span", { class: "sub row" }, ui.status(state), h("span", {}, "·"), h("span", { class: "truncate" }, c.configuration.image.reference)));
    if (state === lastState) return;
    lastState = state;
    const running = state === "running";
    const refresh = () => store.load("containers").then(() => store.loadStats());
    actionsSlot.replaceChildren(
      running
        ? ui.button("Stop", { icon: "stop", onClick: async (e) => { if ((await CS.act(e.currentTarget, "stop", { id }, `Stopped ${id}`)).ok) refresh(); } })
        : ui.button("Start", { icon: "play", kind: "prominent", onClick: async (e) => { if ((await CS.act(e.currentTarget, "start", { id }, `Started ${id}`)).ok) refresh(); } }),
      running ? ui.button("Shell", { icon: "terminal", title: "Open an interactive shell in Terminal", onClick: (e) => CS.act(e.currentTarget, "openShell", { id }) }) : null,
      running ? ui.button("Kill", { icon: "bolt", kind: "destructive", title: "Send SIGKILL", onClick: async (e) => { if ((await CS.act(e.currentTarget, "kill", { id }, `Killed ${id}`)).ok) refresh(); } }) : null,
      ui.button("Delete", {
        icon: "trash", kind: "destructive",
        onClick: async (e) => {
          const result = await CS.act(e.currentTarget, "delete", { id, force: running }, `Deleted ${id}`);
          if (result.ok) { await store.load("containers"); CS.app.navigate("containers"); }
        },
      }));
  }

  function mountTab() {
    tabState?.destroy();
    tabState = CS.containerTabs[tab](tabSlot, id);
  }

  renderHeader();
  mountTab();

  return {
    update(topic) {
      if (topic === "containers") renderHeader();
      tabState?.update(topic);
    },
    destroy() { tabState?.destroy(); },
  };
};

CS.containerTabs = {
  overview(slot, id) {
    const { h, fmt } = CS;
    const store = CS.store;
    const charts = {
      cpu: new CS.LineChart({ title: "CPU", series: [{ key: "cpu", label: "CPU", color: "var(--series-cpu)" }], max: 100, format: (v) => fmt.percent(v), axis: (v) => `${Math.round(v)}%` }),
      memory: new CS.LineChart({ title: "Memory", series: [{ key: "mem", label: "Used", color: "var(--series-memory)" }], floor: 1e8, format: (v) => fmt.bytes(v), axis: (v) => fmt.bytes(v) }),
      network: new CS.LineChart({ title: "Network", series: [{ key: "rx", label: "In", color: "var(--series-rx)" }, { key: "tx", label: "Out", color: "var(--series-tx)" }], floor: 1e4, format: (v) => fmt.rate(v), axis: (v) => fmt.rate(v) }),
      disk: new CS.LineChart({ title: "Disk I/O", series: [{ key: "read", label: "Read", color: "var(--series-read)" }, { key: "write", label: "Write", color: "var(--series-write)" }], floor: 1e4, format: (v) => fmt.rate(v), axis: (v) => fmt.rate(v) }),
    };
    const configSlot = h("div");
    const chartSection = h("section", {},
      CS.ui.sectionHeader("Activity", "Last 3 minutes · CPU is relative to this container's allocated cores"),
      h("div", { class: "grid cols-2" }, Object.values(charts).map((c) => c.el)));
    slot.replaceChildren(h("div", { class: "stack" }, chartSection, configSlot));

    function renderCharts() {
      const c = store.containerById(id);
      const running = c?.status?.state === "running";
      chartSection.hidden = !running;
      const samples = store.history.get(id) || [];
      const last = samples[samples.length - 1];
      charts.memory.max = last?.memLimit ? CS.niceMax(last.memLimit) : undefined;
      for (const chart of Object.values(charts)) chart.update(samples);
    }

    function renderConfig() {
      const c = store.containerById(id);
      if (!c) { configSlot.replaceChildren(); return; }
      const cfg = c.configuration;
      const net = c.status?.networks?.[0];
      const chips = (items) => (items.length ? h("span", { class: "chips" }, items.map((x) => h("span", { class: "badge" }, x))) : h("span", { class: "tertiary" }, "None"));
      const rows = [
        ["Image", h("span", { class: "mono" }, cfg.image.reference)],
        ["Digest", h("span", { class: "mono" }, cfg.image.descriptor.digest)],
        ["Platform", `${cfg.platform.os}/${cfg.platform.architecture}${cfg.platform.variant ? "/" + cfg.platform.variant : ""}${cfg.rosetta ? " · Rosetta" : ""}`],
        ["Resources", `${cfg.resources.cpus} CPUs · ${fmt.bytes(cfg.resources.memoryInBytes, 0)} memory`],
        ["Created", fmt.date(cfg.creationDate)],
        ["Started", c.status?.startedDate ? `${fmt.date(c.status.startedDate)} (up ${fmt.duration(c.status.startedDate)})` : "—"],
        ["Command", h("span", { class: "mono" }, [cfg.initProcess.executable, ...cfg.initProcess.arguments].join(" "))],
        ["Working Dir", h("span", { class: "mono" }, cfg.initProcess.workingDirectory || "/")],
        ["Network", net ? h("span", { class: "mono" }, `${net.network} · ${net.ipv4Address} · gw ${net.ipv4Gateway}`) : (cfg.networks || []).map((n) => n.network || n).join(", ") || "—"],
        ["MAC", net ? h("span", { class: "mono" }, net.macAddress) : "—"],
        ["Hostname", net ? h("span", { class: "mono" }, net.hostname) : "—"],
        ["Ports", chips((cfg.publishedPorts || []).map((p) => `${p.hostAddress && p.hostAddress !== "0.0.0.0" ? p.hostAddress + ":" : ""}${p.hostPort} → ${p.containerPort}/${p.proto || "tcp"}`))],
        ["Mounts", chips((cfg.mounts || []).map((m) => `${CS.mountLabel(m)} → ${m.destination}`))],
        ["Environment", h("div", { class: "mono" }, (cfg.initProcess.environment || []).map((e) => h("div", {}, e)))],
        ["Labels", chips(Object.entries(cfg.labels || {}).map(([k, v]) => `${k}=${v}`))],
      ];
      configSlot.replaceChildren(
        CS.ui.sectionHeader("Configuration"),
        h("div", { class: "group" }, h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))));
    }

    renderCharts();
    renderConfig();
    return {
      update(topic) { if (topic === "stats") renderCharts(); if (topic === "containers") renderConfig(); },
      destroy() { Object.values(charts).forEach((c) => c.destroy()); },
    };
  },

  processes(slot, id) {
    const { h, ui } = CS;
    let timer = null;
    const tableSlot = h("div", {}, ui.loading("Reading process table…"));
    const commandInput = h("input", { type: "text", class: "field-wide mono", placeholder: "Run a command, e.g. df -h", "aria-label": "Command to run in the container", onkeydown: (e) => { if (e.key === "Enter") run(); } });
    const runButton = ui.button("Run", { icon: "play", onClick: () => run() });
    const output = h("pre", { class: "console", hidden: true });
    const autoRefresh = h("input", { type: "checkbox", checked: true, onchange: schedule });

    slot.replaceChildren(h("div", { class: "stack" },
      h("section", {},
        ui.sectionHeader("Processes", "via ps inside the container",
          h("label", { class: "check" }, autoRefresh, "Auto-refresh"),
          ui.iconButton("refresh", "Refresh processes", () => load(), "")),
        tableSlot),
      h("section", {},
        ui.sectionHeader("Run Command", "One-shot, non-interactive. Use Shell for an interactive session."),
        h("div", { class: "row" }, commandInput, runButton),
        h("div", { style: { marginTop: "var(--space-3)" } }, output))));

    function parsePs(text) {
      const lines = text.split("\n").filter((l) => l.trim());
      if (!lines.length) return { header: [], rows: [] };
      const header = lines[0].trim().split(/\s+/);
      const rows = lines.slice(1).map((line) => {
        const parts = line.trim().split(/\s+/);
        return [...parts.slice(0, header.length - 1), parts.slice(header.length - 1).join(" ")];
      });
      return { header, rows };
    }

    async function load() {
      if (CS.store.containerById(id)?.status?.state !== "running") {
        tableSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "Container is not running", "Start it to inspect its processes.")));
        return;
      }
      try {
        const { header, rows } = parsePs(await CS.call("top", { id }));
        const last = header.length - 1;
        ui.showTable(tableSlot, ui.table(
          header.map((title, i) => ({
            title,
            align: i === last ? "" : (["PID", "VSZ", "RSS", "TIME"].includes(title) ? "right" : ""),
            width: i === last ? "auto" : (title === "USER" ? "110px" : "80px"),
            className: i === last ? "copy mono" : "",
            render: (r) => r[i] ?? "",
            tooltip: i === last ? (r) => r[i] : null,
          })),
          rows, { rowKey: (r) => r[0] }));
      } catch (error) {
        tableSlot.replaceChildren(h("div", { class: "group" }, ui.empty("warning", "Couldn't read processes", `${error.message || error}\n\nThe image may not include ps.`)));
      }
    }

    async function run() {
      const argv = CS.shellSplit(commandInput.value);
      if (!argv.length) return;
      output.hidden = false;
      output.textContent = "";
      output.append(h("span", { class: "secondary" }, `$ ${commandInput.value}\n`));
      const result = await CS.act(runButton, "exec", { id, argv });
      output.append(result.ok ? result.out || "(no output)" : h("span", { style: { color: "var(--red)" } }, result.error));
    }

    function schedule() {
      clearInterval(timer);
      if (autoRefresh.checked) timer = setInterval(() => { if (!document.hidden) load(); }, 3000);
    }

    load();
    schedule();
    return { update() {}, destroy() { clearInterval(timer); } };
  },

  logs(slot, id) {
    const { h, ui } = CS;
    let timer = null;
    let text = "";
    const lines = h("select", { "aria-label": "Lines", onchange: () => load() },
      ["200", "1000", "5000"].map((n) => h("option", { value: n, selected: n === "1000" }, `Last ${n} lines`)));
    const boot = h("input", { type: "checkbox", onchange: () => load() });
    const follow = h("input", { type: "checkbox", checked: true, onchange: schedule });
    const find = h("input", { type: "search", class: "search-icon", placeholder: "Find", "aria-label": "Find in logs", style: { width: "200px" }, oninput: () => paint() });
    const consoleEl = h("pre", { class: "console tall", "aria-live": "off" });
    const meta = h("span", { class: "summary" });

    slot.replaceChildren(h("div", {},
      h("div", { class: "section-header" },
        lines,
        h("label", { class: "check" }, boot, "Boot log"),
        h("label", { class: "check" }, follow, "Follow"),
        meta,
        h("div", { class: "spacer" }),
        find,
        ui.iconButton("copy", "Copy logs", () => { navigator.clipboard.writeText(text); CS.toast("Logs copied"); }, "")),
      consoleEl));

    function paint() {
      const stick = consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 24;
      const term = find.value.trim();
      if (!text) {
        consoleEl.replaceChildren(h("span", { class: "tertiary" }, "No log output."));
      } else if (!term) {
        consoleEl.textContent = text;
      } else {
        const parts = text.split(term);
        const nodes = [];
        parts.forEach((p, i) => { nodes.push(p); if (i < parts.length - 1) nodes.push(h("mark", {}, term)); });
        consoleEl.replaceChildren(...nodes);
        meta.textContent = `${parts.length - 1} matches`;
      }
      if (!term) meta.textContent = `${text ? text.split("\n").length - 1 : 0} lines`;
      if (stick) consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    async function load() {
      try {
        text = await CS.call("logs", { id, lines: Number(lines.value), boot: boot.checked });
      } catch (error) {
        text = "";
        consoleEl.replaceChildren(h("span", { style: { color: "var(--red)" } }, String(error.message || error)));
        return;
      }
      paint();
    }

    function schedule() {
      clearInterval(timer);
      if (follow.checked) timer = setInterval(() => { if (!document.hidden) load(); }, 2000);
    }

    load().then(() => { consoleEl.scrollTop = consoleEl.scrollHeight; });
    schedule();
    return { update() {}, destroy() { clearInterval(timer); } };
  },

  inspect(slot, id) {
    const { h, ui } = CS;
    const pre = h("pre", { class: "console tall" });
    let raw = "";
    slot.replaceChildren(h("div", {},
      ui.sectionHeader("Inspect", "container inspect",
        ui.iconButton("copy", "Copy JSON", () => { navigator.clipboard.writeText(raw); CS.toast("JSON copied"); }, ""),
        ui.iconButton("refresh", "Reload", () => load(), "")),
      pre));

    async function load() {
      pre.replaceChildren(ui.loading());
      try {
        raw = JSON.stringify(JSON.parse(await CS.call("inspect", { id })), null, 2);
        pre.replaceChildren(...CS.highlightJSON(raw));
      } catch (error) {
        pre.replaceChildren(h("span", { style: { color: "var(--red)" } }, String(error.message || error)));
      }
    }
    load();
    return { update() {}, destroy() {} };
  },
};

/* Minimal POSIX-ish word splitting: whitespace, single and double quotes, backslash escapes. */
CS.shellSplit = function shellSplit(input) {
  const out = [];
  let cur = "", quote = null, has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') { quote = ch; has = true; }
    else if (ch === "\\" && i + 1 < input.length) { cur += input[++i]; has = true; }
    else if (/\s/.test(ch)) { if (has || cur) { out.push(cur); cur = ""; has = false; } }
    else { cur += ch; has = true; }
  }
  if (has || cur) out.push(cur);
  return out;
};

CS.highlightJSON = function highlightJSON(text) {
  const nodes = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(CS.h("span", { class: m[2] ? "json-key" : "json-string" }, m[1]));
      if (m[2]) nodes.push(m[2]);
    } else if (m[3]) nodes.push(CS.h("span", { class: "json-literal" }, m[3]));
    else nodes.push(CS.h("span", { class: "json-number" }, m[4]));
    last = re.lastIndex;
  }
  nodes.push(text.slice(last));
  return nodes;
};
