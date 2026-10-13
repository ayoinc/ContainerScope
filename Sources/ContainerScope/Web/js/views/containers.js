"use strict";
CS.views = CS.views || {};

CS.views.containers = function containers(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  let filter = "all";
  let query = "";

  const search = h("input", {
    type: "search", class: "search-icon", placeholder: "Filter by name, image, or IP", "aria-label": "Filter containers",
    style: { width: "260px" },
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); render(); },
  });
  const headerSummary = h("span", { class: "summary" });
  const listSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    h("div", {},
      h("div", { class: "section-header" },
        ui.segmented([["all", "All"], ["running", "Running"], ["stopped", "Stopped"]], filter, (v) => { filter = v; render(); }, "Container state"),
        headerSummary,
        h("div", { class: "spacer" }),
        search),
      listSlot)));

  const ipOf = (c) => (c.status?.networks?.[0]?.ipv4Address || "").replace(/\/\d+$/, "");
  const ports = (c) => (c.configuration.publishedPorts || [])
    .map((p) => `${p.hostPort ?? p.hostAddress ?? "?"}→${p.containerPort ?? "?"}`).join(", ");

  async function toggle(c, button) {
    const running = c.status?.state === "running";
    const result = await CS.act(button, running ? "stop" : "start", { id: c.id }, running ? `Stopped ${c.id}` : `Started ${c.id}`);
    if (result.ok) store.load("containers").then(() => store.loadStats());
  }

  function render() {
    if (store.errors.containers && !store.data.containers) {
      listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.containers)));
      return;
    }
    if (!store.data.containers) { listSlot.replaceChildren(ui.loading()); return; }
    const all = store.data.containers;
    const rows = all.filter((c) => {
      const state = c.status?.state;
      if (filter === "running" && state !== "running") return false;
      if (filter === "stopped" && state === "running") return false;
      if (!query) return true;
      return [c.id, c.configuration.image.reference, ipOf(c)].some((s) => s.toLowerCase().includes(query));
    }).sort((a, b) => (a.status?.state === "running" ? 0 : 1) - (b.status?.state === "running" ? 0 : 1) || a.id.localeCompare(b.id));

    const runningCount = all.filter((c) => c.status?.state === "running").length;
    headerSummary.textContent = `${runningCount} running · ${all.length} total`;

    if (!rows.length) {
      listSlot.replaceChildren(h("div", { class: "group" }, all.length
        ? ui.empty("box", "No matches", "No containers match the current filter.")
        : ui.empty("box", "No containers yet", "Create one with “container run --name web nginx” in Terminal.")));
      return;
    }

    ui.showTable(listSlot, ui.table([
      {
        title: "Name", width: "24%",
        render: (c) => [h("span", { class: "primary-cell truncate", style: { display: "block" } }, c.id), h("span", { class: "sub" }, ui.status(c.status?.state))],
      },
      {
        title: "Image", width: "21%",
        render: (c) => { const r = CS.splitRef(c.configuration.image.reference); return [h("span", { class: "truncate", style: { display: "block" } }, r.repo), h("span", { class: "sub" }, r.tag)]; },
        tooltip: (c) => c.configuration.image.reference,
      },
      {
        title: "CPU", align: "right", width: "15%",
        render: (c) => {
          const s = store.latest(c.id);
          if (!s) return h("span", { class: "tertiary" }, "—");
          return h("span", { class: "row", style: { justifyContent: "flex-end" } },
            CS.sparkline((store.history.get(c.id) || []).map((x) => x.cpu), "var(--series-cpu)", 100),
            h("span", { style: { minWidth: "44px" } }, fmt.percent(s.cpu)));
        },
      },
      {
        title: "Memory", align: "right", width: "13%",
        render: (c) => { const s = store.latest(c.id); return s ? [h("span", {}, fmt.bytes(s.mem)), h("span", { class: "sub" }, `of ${fmt.bytes(s.memLimit)}`)] : h("span", { class: "tertiary" }, "—"); },
      },
      {
        title: "Address", width: "16%",
        render: (c) => [h("span", { class: "mono" }, ipOf(c) || "—"), h("span", { class: "sub" }, ports(c) || `${c.configuration.resources.cpus} CPU · ${fmt.bytes(c.configuration.resources.memoryInBytes, 0)}`)],
      },
      {
        title: "", width: "11%", className: "actions",
        render: (c) => {
          const running = c.status?.state === "running";
          const toggleButton = ui.iconButton(running ? "stop" : "play", running ? `Stop ${c.id}` : `Start ${c.id}`, (e) => toggle(c, e.currentTarget));
          return h("div", { class: "row" },
            toggleButton,
            running ? ui.iconButton("terminal", `Open shell in ${c.id}`, (e) => CS.act(e.currentTarget, "openShell", { id: c.id })) : null);
        },
      },
    ], rows, { className: "tall", rowKey: (c) => c.id, onRowClick: (c) => CS.app.navigate(`container/${c.id}`) }));
  }

  render();
  return {
    update(topic) { if (topic === "containers" || topic === "stats") render(); },
    destroy() {},
  };
};
