"use strict";
CS.views = CS.views || {};

CS.views.overview = function overview(root) {
  const { h, fmt, ui, store } = { ...CS, store: CS.store };

  const tile = (label, color) => {
    const value = h("div", { class: "value" }, "—");
    const detail = h("div", { class: "detail" }, " ");
    const meterSlot = h("div");
    const el = h("div", { class: "group metric" },
      h("div", { class: "label" }, color ? h("span", { class: "swatch", style: { background: color } }) : null, label),
      value, detail, meterSlot);
    return { el, value, detail, meterSlot };
  };

  const tiles = {
    containers: tile("Containers"),
    cpu: tile("CPU", "var(--series-cpu)"),
    memory: tile("Memory", "var(--series-memory)"),
    network: tile("Network"),
  };

  const charts = {
    cpu: new CS.LineChart({ title: "CPU", series: [{ key: "cpu", label: "CPU", color: "var(--series-cpu)" }], max: 100, format: (v) => fmt.percent(v), axis: (v) => `${Math.round(v)}%` }),
    memory: new CS.LineChart({ title: "Memory", series: [{ key: "mem", label: "Used", color: "var(--series-memory)" }], floor: 1e8, format: (v) => fmt.bytes(v), axis: (v) => fmt.bytes(v) }),
    network: new CS.LineChart({
      title: "Network",
      series: [{ key: "rx", label: "In", color: "var(--series-rx)" }, { key: "tx", label: "Out", color: "var(--series-tx)" }],
      floor: 1e4, format: (v) => fmt.rate(v), axis: (v) => fmt.rate(v),
    }),
  };

  const diskSlot = h("div");
  const runningSlot = h("div");
  const runningSummary = h("span", { class: "summary" });
  const runningHeader = h("div", { class: "section-header" },
    h("h2", {}, "Running Containers"), runningSummary, h("div", { class: "spacer" }),
    ui.button("Show All", { kind: "plain", onClick: () => CS.app.navigate("containers") }));

  const healthSlot = h("div");
  root.replaceChildren(h("div", { class: "stack" },
    healthSlot,
    h("div", { class: "grid cols-4" }, Object.values(tiles).map((t) => t.el)),
    h("section", {},
      ui.sectionHeader("Activity", "All running containers · last 3 minutes"),
      h("div", { class: "grid cols-2" }, charts.cpu.el, charts.memory.el),
      h("div", { style: { marginTop: "var(--space-3)" } }, charts.network.el)),
    h("section", {}, diskSlot),
    h("section", {}, runningHeader, runningSlot)));

  function renderTiles() {
    const containers = store.data.containers || [];
    const running = containers.filter((c) => c.status?.state === "running");
    tiles.containers.value.replaceChildren(String(running.length), h("small", {}, ` of ${containers.length}`));
    tiles.containers.detail.textContent = running.length ? "running" : "none running";

    const last = store.aggregate[store.aggregate.length - 1];
    if (last && last.cpuCapacity) {
      tiles.cpu.value.textContent = fmt.percent(last.cpu);
      tiles.cpu.detail.textContent = `${last.cores.toFixed(2)} of ${last.cpuCapacity} allocated cores`;
      tiles.cpu.meterSlot.replaceChildren(ui.meter(last.cpu / 100, "var(--series-cpu)"));
      tiles.memory.value.textContent = fmt.bytes(last.mem);
      tiles.memory.detail.textContent = `of ${fmt.bytes(last.memLimit)} allocated`;
      tiles.memory.meterSlot.replaceChildren(ui.meter(last.mem / last.memLimit, "var(--series-memory)"));
      tiles.network.value.textContent = fmt.rate(last.rx + last.tx);
      tiles.network.detail.textContent = `↓ ${fmt.rate(last.rx)}  ↑ ${fmt.rate(last.tx)}`;
    } else {
      for (const t of [tiles.cpu, tiles.memory, tiles.network]) { t.value.textContent = "—"; t.meterSlot.replaceChildren(); }
      tiles.cpu.detail.textContent = running.length ? "Measuring…" : "No running containers";
      tiles.memory.detail.textContent = " ";
      tiles.network.detail.textContent = " ";
    }
  }

  function renderCharts() {
    const last = store.aggregate[store.aggregate.length - 1];
    charts.memory.max = last?.memLimit ? CS.niceMax(last.memLimit) : undefined;
    charts.cpu.update(store.aggregate);
    charts.memory.update(store.aggregate);
    charts.network.update(store.aggregate);
  }

  function renderDisk() {
    const df = store.data.df;
    if (!df) { diskSlot.replaceChildren(); return; }
    const parts = [
      ["Images", df.images, "var(--series-images)"],
      ["Containers", df.containers, "var(--series-containers)"],
      ["Volumes", df.volumes, "var(--series-volumes)"],
    ];
    const total = parts.reduce((sum, [, p]) => sum + p.sizeInBytes, 0);
    const reclaimable = parts.reduce((sum, [, p]) => sum + p.reclaimable, 0);
    diskSlot.replaceChildren(
      ui.sectionHeader("Disk Usage", `${fmt.bytes(total)} used · ${fmt.bytes(reclaimable)} reclaimable`),
      h("div", { class: "group" },
        h("div", { class: "usage-bar", role: "img", "aria-label": parts.map(([n, p]) => `${n} ${fmt.bytes(p.sizeInBytes)}`).join(", ") },
          parts.map(([name, p, color]) => h("span", { title: `${name}: ${fmt.bytes(p.sizeInBytes)}`, style: { flexBasis: `${total ? (p.sizeInBytes / total) * 100 : 0}%`, background: color } }))),
        h("div", { class: "usage-legend" }, parts.map(([name, p, color]) => h("div", { class: "item" },
          h("span", { class: "name" }, h("i", { style: { background: color } }), name),
          h("span", { class: "size" }, fmt.bytes(p.sizeInBytes)),
          h("span", { class: "meta" }, `${p.active} active of ${p.total} · ${fmt.bytes(p.reclaimable)} reclaimable`))))));
  }

  function renderRunning() {
    if (store.errors.containers && !store.data.containers) {
      runningSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.containers)));
      return;
    }
    const running = (store.data.containers || []).filter((c) => c.status?.state === "running");
    runningSummary.textContent = fmt.count(running.length, "container");
    const rows = running
      .map((c) => ({ c, s: store.latest(c.id) }))
      .sort((a, b) => (b.s?.cpu || 0) - (a.s?.cpu || 0));
    if (!rows.length) {
      runningSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "No running containers", "Start one from Containers, or run “container run” in Terminal.")));
      return;
    }
    ui.showTable(runningSlot, ui.table([
      { title: "Name", width: "28%", render: ({ c }) => h("span", { class: "primary-cell" }, c.id) },
      { title: "Image", width: "30%", render: ({ c }) => h("span", { class: "secondary" }, c.configuration.image.reference) },
      { title: "CPU", align: "right", width: "18%", render: ({ c, s }) => h("span", { class: "row", style: { justifyContent: "flex-end" } },
        CS.sparkline((store.history.get(c.id) || []).map((x) => x.cpu), "var(--series-cpu)", 100), h("span", { style: { minWidth: "44px" } }, s ? fmt.percent(s.cpu) : "—")) },
      { title: "Memory", align: "right", width: "14%", render: ({ s }) => (s ? fmt.bytes(s.mem) : "—") },
      { title: "Uptime", align: "right", width: "10%", render: ({ c }) => fmt.duration(c.status.startedDate) },
    ], rows, { rowKey: ({ c }) => c.id, onRowClick: ({ c }) => CS.app.navigate(`container/${c.id}`) }));
  }

  /* NAT networks that should reach the internet but don't: say why, link to the fix. */
  function renderHealth() {
    const blocked = Object.values(store.health).filter((r) => r.verdict === "blocked" || r.verdict === "hostOffline");
    healthSlot.hidden = !blocked.length;
    healthSlot.replaceChildren(...blocked.map((r) => h("div", { class: "callout warning banner", role: "alert" },
      h("div", { class: "text" }, h("strong", {}, `No internet in containers on “${r.network}”: ${r.summary}`), r.fix || r.detail),
      ui.button("Re-test", { kind: "plain", onClick: () => store.diagnose(r.network) }),
      ui.button("Details", { onClick: () => CS.app.navigate("engine") }))));
  }

  renderTiles(); renderCharts(); renderDisk(); renderRunning(); renderHealth();

  return {
    update(topic) {
      if (topic === "stats") { renderTiles(); renderCharts(); renderRunning(); }
      if (topic === "containers") { renderTiles(); renderRunning(); }
      if (topic === "df") renderDisk();
      if (topic === "health") renderHealth();
    },
    destroy() { Object.values(charts).forEach((c) => c.destroy()); },
  };
};
